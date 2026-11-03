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
 */

/** 引导性元话语线索：含引导词且以冒号结尾。 */
const META_CUE = /(追问|回应|发言|提问|说|问|如下|这样)[^。？！\n]{0,6}[:：]/;

const MAX_TEXT_LENGTH = 70;
/** 冒号后至少要有这么多字才认定前半段是元话语。 */
const MIN_BODY_AFTER_CUE = 8;
/** 元话语线索的搜索范围，超出则认为冒号属于正文。 */
const CUE_SEARCH_WINDOW = 30;

/** 清洗模型输出：剥元话语、前缀、引号、Markdown，并裁剪长度。 */
export function cleanOutput(raw: string, maxLength = MAX_TEXT_LENGTH): string {
  let text = raw.trim();

  text = text.replace(/^```(?:\w+)?\s*|\s*```$/g, '');
  text = text.replace(/^(主持发言|主持人|发言)\s*[:：]\s*/i, '');
  text = text.replace(/^【.*?】\s*/, '');

  // 丢弃整行元话语（含引导词且整行以冒号结尾），取第一行真正内容
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const body = lines.filter((line) => !(META_CUE.test(line) && /[:：]\s*$/.test(line)));
  text = body[0] ?? '';

  // 元话语与正文同行：前 30 字内出现引导性冒号则截断前半段
  const head = text.slice(0, CUE_SEARCH_WINDOW);
  const match = head.match(META_CUE);
  if (match?.index !== undefined) {
    const rest = text.slice(match.index + match[0].length).trim();
    if (rest.length >= MIN_BODY_AFTER_CUE) text = rest;
  }

  text = text.replace(/^["'“”「」]+|["'“”「」]+$/g, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*#>`]/g, '');
  text = text.trim();

  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const stop = Math.max(cut.lastIndexOf('？'), cut.lastIndexOf('。'), cut.lastIndexOf('！'));
    text = stop > maxLength * 0.5 ? cut.slice(0, stop + 1) : `${cut}…`;
  }

  return text;
}

export type RejectReason =
  | 'TOO_SHORT'
  | 'LOOKS_LIKE_TRANSCRIPT'
  | 'ECHOES_USER_MESSAGE';

/**
 * 质量闸门。返回拒绝原因，null 表示通过。
 * 调用方据此决定重试或抛错，不得把不合格文本发给房间。
 */
export function rejectOutput(
  text: string,
  recentMessages: readonly { readonly text: string }[] = [],
): RejectReason | null {
  if (text.length < 6) return 'TOO_SHORT';
  // 「昵称：...」形式的转录
  if (/^[^\s:：]{1,8}[:：]/.test(text)) return 'LOOKS_LIKE_TRANSCRIPT';

  for (const message of recentMessages) {
    const source = message.text;
    if (source.length < 8) continue;
    const head = source.slice(0, Math.min(12, source.length));
    if (text.includes(head)) return 'ECHOES_USER_MESSAGE';
  }

  return null;
}
