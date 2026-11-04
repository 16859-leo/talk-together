/**
 * 输出清洗与质量闸门。
 *
 * 规则来源于真实调用中观察到的缺陷，每条都有对应回归测试：
 *   - 元话语：「可以这样追问：」「可以追问：」「把这两点连起来，可以这样回应：」
 *     正则逐个追变体追不完，故改用通用规则：前 30 字内的引导性冒号 + 后面有足够正文则截断。
 *   - 转录式复述：「小林：我觉得远程办公挺好的」—— 把成员原话念一遍是噪音。
 *   - Markdown 残留：「**小林**」会直接显示在聊天气泡里。
 *
 * 关键约束（后端计划 #4 第 74 节）：
 *   契约 AIReply.allOf[2] 规定 status === "completed" 时 text 受 NonBlankText 约束。
 *   因此清洗后为空必须让调用方抛错，绝不能产占位文本凑数。
 *
 * 流式约束（PR #5 第二轮 review P1）：
 *   前导处理（代码围栏、【】标记、「主持发言：」前缀、整行元话语、元话语截断、包裹引号）
 *   都可能**改写已输出的前缀**——例如先收到「主持」，再收到「发言：」，前两个字必须消失。
 *   已 yield 的文本无法撤回，故 analyzeOutput() 额外给出「前导是否已定型」：
 *   为 false 时生成器一个字都不能输出；定型后清洗结果只会向后追加。
 *
 *   超长裁剪同理：原先「在 maxLength 内找最后一个句号」会让结果在后续标点出现时**变短**，
 *   与已输出的增量冲突。现改为固定上限硬裁剪 + 省略号，一旦越过上限结果就固定下来。
 */

/** 输出硬上限。prompt 要求 55 字以内，超出按硬裁剪处理。 */
export const MAX_TEXT_LENGTH = 70;

/**
 * 普通回复（回答、解释、总结）的上限。
 *
 * 话题只要一句话，70 字足够；但「这本书讲了什么」这类回答在 70 字处会被拦腰截断
 * （真实调用里出现过「…结果两人互相治愈，医生自…」）。回答类允许更长的正文，
 * 上限仍然存在，避免模型写成小作文。
 */
export const MAX_REPLY_TEXT_LENGTH = 120;

/** 可交付文本的最短长度；低于它视为「没说话」，不能算完成。 */
export const MIN_TEXT_LENGTH = 6;

/** 元话语线索的搜索范围，超出则认为冒号属于正文。 */
const CUE_SEARCH_WINDOW = 30;
/** 冒号后至少要有这么多字才认定前半段是元话语。 */
const MIN_BODY_AFTER_CUE = 8;
/** 只有不超过这个长度的行才会被整行丢弃；长行带冒号通常仍有正文。 */
const MAX_META_ONLY_LINE = CUE_SEARCH_WINDOW;

/** 引导性元话语线索：含引导词且以冒号结尾。 */
const META_CUE = /(追问|回应|发言|提问|说|问|如下|这样)[^。？！\n]{0,6}[:：]/;

/** 会被整段剥离的行首标记（与 stripLeadingMarkers 的正则保持一致）。 */
const LEADING_MARKERS = ['主持发言', '主持人', '发言'] as const;

/** 清洗结果：「已定型的正文」+「前导是否还会被后续字符改写」。 */
export interface OutputAnalysis {
  /** 清洗并裁剪后的正文。headSettled 为 false 时可能还会变，调用方不应输出。 */
  readonly text: string;
  /**
   * 前导是否已定型。为 false 时后续字符仍可能改写输出起点
   * （补上「发言：」会吞掉之前的字、元话语截断会砍掉前缀、【】未闭合会被整段剥离），
   * 此时任何已 yield 的文本都无法撤回，因此必须继续缓冲。
   */
  readonly headSettled: boolean;
}

/**
 * 前导标记是否可能还没写完：
 *   - 文本整体是某个标记的前缀（「主持」「发」），后面补字就可能被剥离；
 *   - 已完整匹配标记、但后面只有空白，冒号随时可能到来。
 */
function isLeadingMarkerPending(text: string): boolean {
  if (text.length === 0) return true;
  for (const marker of LEADING_MARKERS) {
    if (marker.startsWith(text)) return true;
    if (!text.startsWith(marker)) continue;
    const rest = text.slice(marker.length);
    if (/^[ \t]*$/.test(rest)) return true;
  }
  return false;
}

/**
 * 超长裁剪：固定在上限处硬裁剪。
 * 只要越过上限，结果就与后续内容无关（不会因新标点而变短），保证流式增量只追加不回头。
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  if (/[。！？…]$/.test(cut)) return cut;
  return `${cut.slice(0, maxLength - 1)}…`;
}

/** 清洗 raw 并给出前导是否已定型。生成器用它决定能否开始 yield。 */
export function analyzeOutput(raw: string, maxLength = MAX_TEXT_LENGTH): OutputAnalysis {
  const trimmed = raw.trim();

  // 未凑齐的代码围栏（` 或 ``）随时可能变成 ``` 而被整体剥离
  if (/^`{1,2}$/.test(trimmed)) {
    return { text: '', headSettled: false };
  }

  // 先剥掉外层围栏，再做后续检查：若先看原文，```，【... 这种组合会因为
  // 原文以围栏开头而漏掉「未闭合【】」，剥完围栏后内部标记就会被误判为已定型。
  let head = trimmed.replace(/^```(?:\w+)?\s*/, '');
  // 已闭合的【】可以连续剥掉；剥完仍以【开头，说明这个标记还没闭合
  while (/^【.*?】\s*/.test(head)) {
    head = head.replace(/^【.*?】\s*/, '');
  }
  if (head.startsWith('【')) {
    return { text: '', headSettled: false };
  }
  // 「主持」->「主持发言：」会让开头两个字消失
  if (isLeadingMarkerPending(head)) {
    return { text: '', headSettled: false };
  }

  const stripped = head.replace(/^(主持发言|主持人|发言)\s*[:：]\s*/i, '');

  const rawLines = stripped.split('\n');
  const entries = rawLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line.length > 0);

  // 取第一行真正内容。整行元话语（含引导词且整行以冒号结尾）丢弃，
  // 但只丢「短行」：长行里带冒号通常还有正文，整行丢弃会连正文一起吞掉，
  // 而且会让已经输出的前缀失去依据（流式下无法撤回）。
  let selected: { readonly line: string; readonly index: number } | undefined;
  let cut: CueCut = { rest: '', matched: false, applied: false };
  for (const entry of entries) {
    const entryCut = analyzeCueCut(entry.line);
    const metaOnlyLine =
      !entryCut.applied &&
      entry.line.length <= MAX_META_ONLY_LINE &&
      /[:：]\s*$/.test(entry.line) &&
      META_CUE.test(entry.line);
    if (metaOnlyLine) continue;
    selected = entry;
    cut = entryCut;
    break;
  }
  if (selected === undefined) {
    // 目前全是元话语/空白，正文还没出现
    return { text: '', headSettled: false };
  }

  // 该行后面还有换行 => 行已写完，行内的判定不会再变
  const lineComplete = selected.index < rawLines.length - 1;
  const body = cut.applied ? cut.rest : selected.line;

  let headSettled: boolean;
  if (cut.applied) {
    // 截断已生效：cleanOutput 只截第一次匹配，后续补字只会在 rest 后面追加
    headSettled = true;
  } else if (cut.matched) {
    // 命中引导词但冒号后还不足 8 字：后续补字随时可能触发截断，前缀仍会变
    headSettled = lineComplete;
  } else {
    // 前 30 字内没有引导冒号，且该行已超出「可整行丢弃」的长度：
    // 后续字符既不会触发截断，也不会让整行被丢弃
    headSettled = lineComplete || selected.line.length >= CUE_SEARCH_WINDOW;
  }

  let text = body;
  text = text.replace(/^["'“”「」]+|["'“”「」]+$/g, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*#>`]/g, '');
  text = text.trim();

  return { text: truncate(text, maxLength), headSettled };
}

/** 元话语截断信息：是否命中引导词、命中后截断是否已生效、以及截断后的正文。 */
interface CueCut {
  readonly rest: string;
  readonly matched: boolean;
  readonly applied: boolean;
}

/** 计算元话语截断点：取行首窗口内第一个「引导词 + 冒号」，冒号后够长才截断。 */
function analyzeCueCut(line: string): CueCut {
  const match = line.slice(0, CUE_SEARCH_WINDOW).match(META_CUE);
  if (match?.index === undefined) return { rest: '', matched: false, applied: false };
  const rest = line.slice(match.index + match[0].length).trim();
  return { rest, matched: true, applied: rest.length >= MIN_BODY_AFTER_CUE };
}

/** 清洗模型输出：剥元话语、前缀、引号、Markdown，并裁剪长度。 */
export function cleanOutput(raw: string, maxLength = MAX_TEXT_LENGTH): string {
  return analyzeOutput(raw, maxLength).text;
}

export type RejectReason =
  | 'TOO_SHORT'
  | 'LOOKS_LIKE_TRANSCRIPT'
  | 'ECHOES_USER_MESSAGE';

/** 闸门需要的最近发言：正文必备，昵称用于识别「谁：正文」式转录。 */
export interface RecentMessageView {
  readonly text: string;
  readonly nickname?: string;
}

/**
 * 质量闸门。返回拒绝原因，null 表示通过。
 * 调用方据此决定重试或抛错，不得把不合格文本发给房间。
 *
 * `memberNicknames` 是房间内成员昵称：只有冒号前的短标签确实是某位成员时，
 * 才判成「转录式复述」。否则「换个话题：」「补充一下：」这类正常的引导语会被误杀
 * （真实缺陷：AI 说「换个话题：你露营时拍过哪张照片…」被连续三轮判成转录）。
 * 没提供任何昵称时退回旧的启发式判断，保持独立调用方的行为不变。
 */
export function rejectOutput(
  text: string,
  recentMessages: readonly RecentMessageView[] = [],
  memberNicknames: readonly string[] = [],
): RejectReason | null {
  if (text.length < MIN_TEXT_LENGTH) return 'TOO_SHORT';

  // 「昵称：...」形式的转录。
  const label = /^([^\s:：]{1,8})[:：]/.exec(text);
  if (label) {
    const names = new Set(memberNicknames.filter((name) => name.trim().length > 0));
    for (const message of recentMessages) {
      if (typeof message.nickname === 'string' && message.nickname.trim().length > 0) {
        names.add(message.nickname);
      }
    }
    if (names.size === 0 || names.has(label[1]!)) return 'LOOKS_LIKE_TRANSCRIPT';
  }

  for (const message of recentMessages) {
    const source = message.text;
    if (source.length < 8) continue;
    const head = source.slice(0, Math.min(12, source.length));
    if (text.includes(head)) return 'ECHOES_USER_MESSAGE';
  }

  return null;
}
