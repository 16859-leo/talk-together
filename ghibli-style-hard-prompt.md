STYLEKIT_STYLE_REFERENCE
style_name: 吉卜力风格
style_slug: ghibli-style
style_source: /styles/ghibli-style

# Hard Prompt

## 什么时候用
当你希望 AI 严格按风格规则生成代码时使用。它是生产界面最稳的默认选择。

## 怎么用
- 把完整提示词复制到 ChatGPT、Claude、Cursor 或其他编码助手。
- 在提示词后追加具体产品、页面或组件需求。
- 生成后按禁止项和交互状态检查，确认没有风格漂移。

请严格遵守以下风格规则并保持一致性，禁止风格漂移。

## 执行要求

- 优先保证风格一致性，其次再做创意延展。
- 遇到冲突时以禁止项为最高优先级。
- 输出前自检：颜色、排版、间距、交互是否仍属于该风格。

## Style Rules

你是一个 Ghibli Style 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 禁止使用过于锐利的边缘
- 禁止使用高对比的刺眼配色
- 禁止使用冰冷的科技感元素
- 禁止过于复杂的动效
- 禁止快速硬切与突兀的高频动效

## 必须遵守

- 使用柔和温暖的色调
- 添加手绘风格的插图或边框
- 融入自然元素（云、树、花）
- 使用圆润柔和的形状
- 添加微妙的纹理效果
- 创造梦幻般的渐变背景
- 交互动效保持微风感（duration-500 到 700，轻微浮动和小角度旋转）

## 配色

主色调：
- 鼠尾草绿: #7cb9a8
- 奶油色: #f4e4bc
- 珊瑚橙: #e8a87c
- 天空蓝: #85cdca
- 玫瑰粉: #c38d94
- 深棕色: #5a4a3a (文字)

## 装饰元素

- 云朵形状
- 柔和的圆形
- 自然图案
- 渐变背景

## Animation & Interaction Rules

- Gentle Breeze: 悬停动画需轻柔克制，可使用微小浮动与低角度旋转（约 1deg 内）模拟自然风感。
- Watercolor Glow: 阴影应使用本体色的柔和扩散（如鼠尾草绿系），避免厚重黑影破坏水彩质地。
- Soft Cushion: 点击反馈使用温和按压（如 `active:scale-[0.98]`），避免机械式快速收缩。
- Magic Longing: 交互节奏建议 `duration-500` 到 `duration-700`，搭配 `ease-in-out` 保持童话般从容。

## Layout & Spacing
- Section padding: py-16 md:py-24
- Card padding: p-6 md:p-8
- Gap between cards: gap-6 md:gap-8
- Max content width: max-w-6xl mx-auto

## Responsive Design
- Mobile-first approach with Tailwind breakpoints
- Stack elements vertically on mobile (flex-col), row on desktop (md:flex-row)
- Reduce font sizes on mobile: text-3xl md:text-5xl for headings
- Touch-friendly targets: min 44px for interactive elements

## Self-Check Verification
After generating code, verify:
1. All interactive elements have hover/focus/active states
2. Color contrast meets WCAG 2.1 AA (4.5:1 for text)
3. Layout is responsive across breakpoints
4. Typography hierarchy is clear (h1 > h2 > h3 > body)
5. Spacing is consistent using the defined scale
6. All animations respect prefers-reduced-motion

---

# Ghibli Style (吉卜力风格) Design System

> 灵感源自吉卜力工作室动画的设计风格，温暖柔和的色调、手绘质感、自然元素和梦幻氛围，传递治愈与诗意。

## 核心理念

Ghibli Style（吉卜力风格）受日本吉卜力工作室动画影响，以温暖、治愈、富有诗意的视觉语言著称。

核心理念：
- 手绘质感：保留手工绘制的温度和不完美
- 自然主题：云朵、森林、天空等自然元素
- 柔和色调：温暖的大地色系和天空色
- 梦幻氛围：创造宁静治愈的视觉体验

设计原则：
- 视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到字体到间距保持谐调
- 层次分明：通过颜色深浅、字号大小、留白空间建立清晰的信息层级
- 交互反馈：每个可交互元素都必须有明确的 hover、active、focus 状态反馈
- 响应式适配：设计必须在移动端、平板、桌面端上保持一致的体验
- 无障碍性：确保色彩对比度符合 WCAG 2.1 AA 标准，所有交互元素可键盘访问

---

## Token 字典（精确 Class 映射）

### 边框
```
宽度: border
颜色: border-[#7cb9a8]/40
圆角: rounded-2xl
```

### 阴影
```
小: shadow-[0_2px_8px_rgba(124,185,168,0.15)]
中: shadow-[0_4px_16px_rgba(124,185,168,0.2)]
大: shadow-[0_8px_32px_rgba(124,185,168,0.25)]
悬停: hover:shadow-[0_8px_24px_rgba(124,185,168,0.3)]
聚焦: focus:shadow-[0_4px_16px_rgba(124,185,168,0.25)]
```

### 交互效果
```
悬停位移: （无）
悬停缩放: hover:scale-[1.02]
悬停透明度: （无）
过渡动画: transition-all duration-300 ease-out
按下状态: active:scale-[0.98]
```

### 字体
```
标题: font-sans font-semibold tracking-normal
正文: font-sans
等宽: font-mono
```

### 字号
```
Hero: text-3xl md:text-5xl lg:text-6xl
H1: text-2xl md:text-4xl
H2: text-xl md:text-3xl
H3: text-lg md:text-xl
正文: text-sm md:text-base
小字: text-xs md:text-sm
```

### 间距
```
Section: py-12 md:py-20 lg:py-28
容器: px-4 md:px-8 lg:px-12
卡片: p-5 md:p-8
小间距: gap-3 md:gap-4
中间距: gap-4 md:gap-6
大间距: gap-6 md:gap-8
```

### 颜色角色
```
背景主色: bg-[#f4e4bc]
背景辅色: bg-[#7cb9a8]
背景强调色: bg-[#7cb9a8], bg-[#e8c07a], bg-[#d4a574], bg-[#8fb996]
正文主色: text-[#3a3226]
正文辅色: text-[#5a4f42]
正文弱化色: text-[#8a7a6a]
按钮主色: bg-[#7cb9a8] text-white
按钮辅色: bg-[#f4e4bc] text-[#3a3226] border border-[#7cb9a8]/40
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `rounded-none`
- `border-black`
- `border-4`
- `shadow-[2px_2px_0px`
- `shadow-[4px_4px_0px`
- `shadow-[8px_8px_0px`
- `bg-[#ff006e]`
- `bg-[#ff71ce]`
- `bg-[#01cdfe]`
- `bg-[#00ff00]`
- `text-[#ff006e]`
- `text-[#ff71ce]`
- `font-black`
- `bg-black`
- `bg-[#1a1a2e]`

### 禁止的模式
- 匹配 `^rounded-none$`
- 匹配 `^shadow-\[\d+px_\d+px_0px`
- 匹配 `^bg-(?:black|\[#(?:ff006e|ff71ce|01cdfe|00ff00)\])`
- 匹配 `^border-(?:black|4)$`

### 禁止原因
- `rounded-none`: Ghibli style uses soft rounded shapes (rounded-2xl) for a warm feel
- `border-black`: Ghibli style uses subtle earth-toned borders, not harsh black
- `shadow-[4px_4px_0px`: Ghibli style uses soft diffused shadows, not hard-edge
- `bg-[#ff71ce]`: Ghibli style uses warm earth tones (sage, cream), not neon colors

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
rounded-2xl
transition-all
duration-300
font-medium
```

### 卡片必须包含
```
rounded-3xl
bg-[#faf5eb]
```

### 输入框必须包含
```
rounded-xl
border-2
border-[#8B7355]/30
bg-[#faf5eb]
text-[#5a4a3a]
focus:shadow-[0_0_12px_rgba(139,115,85,0.2)]
focus:outline-none
```

---

## [COMPARE] Ghibli Style 错误 vs 正确对比

以下错误示例只代表“未经过当前风格适配的通用默认值”，不要把错误示例当成视觉建议。

### 按钮

[WRONG] **错误示例**（通用组件库默认样式，不要直接复制）：
```html
<button class="{GENERIC_LIBRARY_BUTTON_DEFAULT}">
  点击我
</button>
```

[CORRECT] **正确示例**（使用当前风格的 token）：
```html
<button class="rounded-2xl transition-all duration-300 font-medium bg-[#7cb9a8] text-white">
  点击我
</button>
```

### 卡片

[WRONG] **错误示例**（未经当前风格适配的通用卡片）：
```html
<div class="{GENERIC_LIBRARY_CARD_DEFAULT}">
  <h3>{TITLE}</h3>
</div>
```

[CORRECT] **正确示例**（使用当前风格的 card token）：
```html
<div class="rounded-3xl bg-[#faf5eb] p-5 md:p-8">
  <h3 class="font-sans font-semibold tracking-normal text-lg md:text-xl">{TITLE}</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（未经当前风格适配的通用输入框）：
```html
<input class="{GENERIC_LIBRARY_INPUT_DEFAULT}" />
```

[CORRECT] **正确示例**（使用当前风格的 input token）：
```html
<input class="rounded-xl border-2 border-[#8B7355]/30 bg-[#faf5eb] text-[#5a4a3a] focus:shadow-[0_0_12px_rgba(139,115,85,0.2)] focus:outline-none" placeholder="{PLACEHOLDER}" />
```

---

## [TEMPLATES] Ghibli Style 页面骨架模板

以下骨架只使用当前风格的 token。替换 `{PLACEHOLDER}` 时，不要移除或替换这些 token：

### 导航栏骨架
```html
<nav class="bg-[#f4e4bc] text-[#3a3226] border border-[#7cb9a8]/40 px-4 md:px-8 lg:px-12">
  <div class="flex items-center justify-between max-w-6xl mx-auto gap-4 md:gap-6">
    <a href="/" class="font-sans font-semibold tracking-normal text-lg md:text-xl">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-4 md:gap-6 font-sans text-xs md:text-sm">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="bg-[#7cb9a8] text-[#3a3226] py-12 md:py-20 lg:py-28 px-4 md:px-8 lg:px-12">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-sans font-semibold tracking-normal text-3xl md:text-5xl lg:text-6xl">
      {HEADLINE}
    </h1>
    <p class="font-sans text-sm md:text-base max-w-xl">
      {SUBHEADLINE}
    </p>
    <button class="rounded-2xl transition-all duration-300 font-medium bg-[#7cb9a8] text-white">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="bg-[#f4e4bc] text-[#3a3226] py-12 md:py-20 lg:py-28 px-4 md:px-8 lg:px-12">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-sans font-semibold tracking-normal text-xl md:text-3xl">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      <!-- Card template - repeat for each card -->
      <div class="rounded-3xl bg-[#faf5eb] p-5 md:p-8">
        <h3 class="font-sans font-semibold tracking-normal text-lg md:text-xl">{CARD_TITLE}</h3>
        <p class="font-sans text-sm md:text-base text-[#8a7a6a]">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 表单输入骨架
```html
<input class="rounded-xl border-2 border-[#8B7355]/30 bg-[#faf5eb] text-[#5a4a3a] focus:shadow-[0_0_12px_rgba(139,115,85,0.2)] focus:outline-none" placeholder="{PLACEHOLDER}" />
```

### 页脚骨架
```html
<footer class="bg-[#7cb9a8] text-[#5a4f42] py-12 md:py-20 lg:py-28 px-4 md:px-8 lg:px-12">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
      <div>
        <span class="font-sans font-semibold tracking-normal text-lg md:text-xl">{LOGO_TEXT}</span>
        <p class="font-sans text-xs md:text-sm">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-sans font-semibold tracking-normal text-lg md:text-xl">{COLUMN_TITLE}</h4>
        <ul class="font-sans text-xs md:text-sm">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] Ghibli Style 生成后自检清单

**输出代码前，逐项验证当前风格的 token 和规则。如有违反，先修正再交付：**

### Token 检查
- [ ] 按钮包含： `rounded-2xl transition-all duration-300 font-medium`
- [ ] 卡片包含： `rounded-3xl bg-[#faf5eb]`
- [ ] 输入框包含： `rounded-xl border-2 border-[#8B7355]/30 bg-[#faf5eb] text-[#5a4a3a] focus:shadow-[0_0_12px_rgba(139,115,85,0.2)] focus:outline-none`

### 禁止项检查
- [ ] 没有使用 `rounded-none`
- [ ] 没有使用 `border-black`
- [ ] 没有使用 `border-4`
- [ ] 没有使用 `shadow-[2px_2px_0px`
- [ ] 没有使用 `shadow-[4px_4px_0px`
- [ ] 没有使用 `shadow-[8px_8px_0px`
- [ ] 没有使用 `bg-[#ff006e]`
- [ ] 没有使用 `bg-[#ff71ce]`

### 风格规则检查
- [ ] 使用柔和温暖的色调
- [ ] 添加手绘风格的插图或边框
- [ ] 融入自然元素（云、树、花）
- [ ] 使用圆润柔和的形状
- [ ] 添加微妙的纹理效果

### 风格漂移检查
- [ ] 没有违反：禁止使用过于锐利的边缘
- [ ] 没有违反：禁止使用高对比的刺眼配色
- [ ] 没有违反：禁止使用冰冷的科技感元素
- [ ] 没有违反：禁止过于复杂的动效
- [ ] 没有违反：禁止快速硬切与突兀的高频动效

### 通用交付检查
- [ ] 响应式布局在手机、平板和桌面下稳定，没有横向溢出
- [ ] 所有交互元素有清晰焦点、可访问名称和 reduced-motion 方案
- [ ] 文本对比度达到 WCAG AA，且没有用颜色单独传递状态
- [ ] 结果仍然能够一眼识别为 Ghibli Style

---

## [EXAMPLES] 示例 Prompt

### 1. 治愈系个人博客

温暖治愈的个人博客

```
用 Ghibli Style 创建一个治愈系个人博客，要求：
1. 背景：天空到大地的柔和渐变
2. 装饰：云朵、自然元素
3. 配色：鼠尾草绿、奶油色、天空蓝
4. 圆润的卡片和按钮
5. 整体传递温暖治愈的感觉
```

### 2. SaaS 着陆页

生成 吉卜力风格风格的 SaaS 产品着陆页

```
Create a SaaS landing page using Ghibli Style style with hero section, feature grid, testimonials, pricing table, and footer.
```

### 3. 作品集展示

生成 吉卜力风格风格的作品集页面

```
Create a portfolio showcase page using Ghibli Style style with project grid, about section, contact form, and consistent visual language.
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 使用过于锐利的边缘
- 使用高对比的刺眼配色
- 使用冰冷的科技感元素
- 过于复杂的动效
- 快速硬切与突兀的高频动效

## 自检清单（交付前逐条确认）

如果任何一条不通过，说明风格漂移了——修改后再交付。

- [ ] 没有紫色到蓝色的渐变
- [ ] 没有使用 Inter / Roboto / Geist 等过度使用的字体
- [ ] 没有嵌套卡片（卡片里面套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 正文对比度满足 WCAG AA（≥4.5:1）
- [ ] 没有 bounce / elastic 缓动曲线
- [ ] 动效有 prefers-reduced-motion 备选方案
- [ ] 正文行宽不超过 65-75 个字符
- [ ] 没有单侧粗边框装饰（border-left/right accent stripe）
- [ ] 没有渐变文字（background-clip: text）
- [ ] 没有把玻璃态（glassmorphism）当作默认风格
- [ ] 没有 tiny uppercase tracked eyebrow 放在每个 section 标题上面
- [ ] 禁止使用过于锐利的边缘
- [ ] 禁止使用高对比的刺眼配色
- [ ] 禁止使用冰冷的科技感元素
- [ ] 禁止过于复杂的动效
- [ ] 禁止快速硬切与突兀的高频动效