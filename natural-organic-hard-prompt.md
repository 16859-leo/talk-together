STYLEKIT_STYLE_REFERENCE
style_name: 自然有机风
style_slug: natural-organic
style_source: /styles/natural-organic

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

STYLE: Natural Organic
TYPE: Warm, earthy, nature-inspired design

## 必须遵守

- 使用大地色系 amber, stone, olive, sage
- 背景使用温暖的米色 bg-[#faf6f1], bg-amber-50
- 使用不规则圆角 rounded-[2rem] 或 blob 形状
- 添加纸张/织物纹理 (可通过 CSS 或 SVG)
- 使用手写风格或衬线字体
- 按钮使用柔和的过渡 hover:bg-stone-200
- 图片使用自然/有机/手工内容

## 绝对禁止

- 禁止使用冷色调（蓝、紫除非作为辅助）
- 禁止使用纯黑 #000000
- 禁止使用尖锐的几何形状
- 禁止使用高科技感的设计元素
- 禁止使用霓虹/高饱和度颜色
- 禁止使用完美的圆形/矩形

COLOR PALETTE:
- Primary: Stone/Brown (#5c4033)
- Background: Warm cream (#faf6f1)
- Accent: Sage green (#8b9d77)
- Secondary: Warm tan (#d4a373)

TYPOGRAPHY:
- Headings: font-serif, tracking-tight
- Body: font-sans, stone-600
- Comfortable line-height

## Animation & Interaction Rules

- Organic Morphing: 使用不规则圆角（blob）并在交互中缓慢变化，避免工业化标准圆角。
- Soft Earth Press: hover 可轻微下沉（translate-y-0.5）并加深土色层次，不做漂浮弹跳。
- Botanical Slowness: 动画节奏建议 duration-500 以上 + ease-in-out，模拟自然生长速度。
- Verdant Tint: 交互时文字/图标向深绿色缓慢过渡，表达植物被光照唤醒的生命感。

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

# Natural Organic (自然有机风) Design System

> 温暖自然的有机风格，大地色系、自然纹理、手工感元素。适合健康品牌、有机食品、环保产品、手工艺品。

## 核心理念

Natural Organic 风格从自然界汲取灵感，通过大地色系、有机形状和自然纹理创造温暖亲切的体验。

核心理念：
- 自然和谐：色彩和形状来自自然界
- 温暖亲切：让用户感到舒适和信任
- 手工质感：避免过于工业化的冷感
- 可持续美学：简约但不冷淡

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
颜色: border-stone-200
圆角: rounded-full
```

### 阴影
```
小: shadow-none
中: shadow-sm
大: shadow-md
悬停: shadow-md
聚焦: ring-2 ring-stone-300
```

### 交互效果
```
悬停位移: （无）
悬停缩放: （无）
悬停透明度: hover:bg-stone-100
过渡动画: transition-colors duration-300
按下状态: active:scale-95
```

### 字体
```
标题: font-serif
正文: font-sans
等宽: font-mono
```

### 字号
```
Hero: text-4xl md:text-5xl lg:text-6xl
H1: text-3xl md:text-4xl
H2: text-2xl md:text-3xl
H3: text-xl md:text-2xl
正文: text-sm md:text-base
小字: text-xs
```

### 间距
```
Section: py-16 md:py-24
容器: px-6 md:px-12
卡片: p-6 md:p-8
小间距: gap-4
中间距: gap-6 md:gap-8
大间距: gap-8 md:gap-12
```

### 颜色角色
```
背景主色: bg-[#faf6f1]
背景辅色: bg-white
背景强调色: bg-[#8b9d77], bg-[#d4a373], bg-stone-800
正文主色: text-stone-800
正文辅色: text-stone-600
正文弱化色: text-stone-600
按钮主色: bg-stone-800 text-stone-50
按钮辅色: bg-transparent text-stone-800 border border-stone-300
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `bg-blue-500`
- `bg-purple-500`
- `bg-cyan-500`
- `text-black`
- `rounded-none`
- `rounded-sm`
- `shadow-lg`
- `shadow-xl`
- `shadow-2xl`
- `bg-gradient-to-r`

### 禁止的模式
- 匹配 `^bg-blue-`
- 匹配 `^bg-purple-`
- 匹配 `^bg-cyan-`
- 匹配 `^bg-gradient-`
- 匹配 `^shadow-[lx2]`

### 禁止原因
- `bg-blue-500`: Natural Organic uses warm earth tones, not cool colors
- `rounded-none`: Natural Organic uses organic shapes (rounded-full, rounded-[2rem])
- `shadow-xl`: Natural Organic avoids heavy shadows, keep it subtle
- `bg-gradient-to-r`: Natural Organic uses solid, natural colors

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
rounded-full
font-medium
transition-colors
duration-300
```

### 卡片必须包含
```
bg-[#faf6f1]
rounded-[2rem]
border
border-stone-200
```

### 输入框必须包含
```
bg-white
border
border-stone-200
rounded-full
text-stone-800
placeholder:text-stone-400
focus:border-stone-400
focus:ring-2
focus:ring-stone-200
transition-all
duration-300
```

---

## [COMPARE] Natural Organic 错误 vs 正确对比

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
<button class="rounded-full font-medium transition-colors duration-300 bg-stone-800 text-stone-50">
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
<div class="bg-[#faf6f1] rounded-[2rem] border border-stone-200 p-6 md:p-8">
  <h3 class="font-serif text-xl md:text-2xl">{TITLE}</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（未经当前风格适配的通用输入框）：
```html
<input class="{GENERIC_LIBRARY_INPUT_DEFAULT}" />
```

[CORRECT] **正确示例**（使用当前风格的 input token）：
```html
<input class="bg-white border border-stone-200 rounded-full text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 transition-all duration-300" placeholder="{PLACEHOLDER}" />
```

---

## [TEMPLATES] Natural Organic 页面骨架模板

以下骨架只使用当前风格的 token。替换 `{PLACEHOLDER}` 时，不要移除或替换这些 token：

### 导航栏骨架
```html
<nav class="bg-[#faf6f1] text-stone-800 border border-stone-200 px-6 md:px-12">
  <div class="flex items-center justify-between max-w-6xl mx-auto gap-6 md:gap-8">
    <a href="/" class="font-serif text-xl md:text-2xl">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-6 md:gap-8 font-sans text-xs">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="bg-[#8b9d77] text-stone-800 py-16 md:py-24 px-6 md:px-12">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-serif text-4xl md:text-5xl lg:text-6xl">
      {HEADLINE}
    </h1>
    <p class="font-sans text-sm md:text-base max-w-xl">
      {SUBHEADLINE}
    </p>
    <button class="rounded-full font-medium transition-colors duration-300 bg-stone-800 text-stone-50">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="bg-[#faf6f1] text-stone-800 py-16 md:py-24 px-6 md:px-12">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-serif text-2xl md:text-3xl">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
      <!-- Card template - repeat for each card -->
      <div class="bg-[#faf6f1] rounded-[2rem] border border-stone-200 p-6 md:p-8">
        <h3 class="font-serif text-xl md:text-2xl">{CARD_TITLE}</h3>
        <p class="font-sans text-sm md:text-base text-stone-600">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 表单输入骨架
```html
<input class="bg-white border border-stone-200 rounded-full text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 transition-all duration-300" placeholder="{PLACEHOLDER}" />
```

### 页脚骨架
```html
<footer class="bg-white text-stone-600 py-16 md:py-24 px-6 md:px-12">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
      <div>
        <span class="font-serif text-xl md:text-2xl">{LOGO_TEXT}</span>
        <p class="font-sans text-xs">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-serif text-xl md:text-2xl">{COLUMN_TITLE}</h4>
        <ul class="font-sans text-xs">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] Natural Organic 生成后自检清单

**输出代码前，逐项验证当前风格的 token 和规则。如有违反，先修正再交付：**

### Token 检查
- [ ] 按钮包含： `rounded-full font-medium transition-colors duration-300`
- [ ] 卡片包含： `bg-[#faf6f1] rounded-[2rem] border border-stone-200`
- [ ] 输入框包含： `bg-white border border-stone-200 rounded-full text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 transition-all duration-300`

### 禁止项检查
- [ ] 没有使用 `bg-blue-500`
- [ ] 没有使用 `bg-purple-500`
- [ ] 没有使用 `bg-cyan-500`
- [ ] 没有使用 `text-black`
- [ ] 没有使用 `rounded-none`
- [ ] 没有使用 `rounded-sm`
- [ ] 没有使用 `shadow-lg`
- [ ] 没有使用 `shadow-xl`

### 风格规则检查
- [ ] 使用大地色系 amber, stone, olive, sage
- [ ] 背景使用温暖的米色 bg-[#faf6f1], bg-amber-50
- [ ] 使用不规则圆角 rounded-[2rem] 或 blob 形状
- [ ] 添加纸张/织物纹理 (可通过 CSS 或 SVG)
- [ ] 使用手写风格或衬线字体

### 风格漂移检查
- [ ] 没有违反：禁止使用冷色调（蓝、紫除非作为辅助）
- [ ] 没有违反：禁止使用纯黑 #000000
- [ ] 没有违反：禁止使用尖锐的几何形状
- [ ] 没有违反：禁止使用高科技感的设计元素
- [ ] 没有违反：禁止使用霓虹/高饱和度颜色

### 通用交付检查
- [ ] 响应式布局在手机、平板和桌面下稳定，没有横向溢出
- [ ] 所有交互元素有清晰焦点、可访问名称和 reduced-motion 方案
- [ ] 文本对比度达到 WCAG AA，且没有用颜色单独传递状态
- [ ] 结果仍然能够一眼识别为 Natural Organic

---

## [EXAMPLES] 示例 Prompt

### 1. 有机品牌

生成有机食品品牌网站

```
Create an organic brand website using Natural Organic style:
- Hero with large product image on cream background
- Feature cards with organic shapes and sage green accents
- Testimonials with hand-drawn style elements
- Newsletter signup with rounded-full input
- Footer with earth-tone color blocks
- Font-serif for headings, warm color palette
```

### 2. SaaS 着陆页

生成 自然有机风风格的 SaaS 产品着陆页

```
Create a SaaS landing page using Natural Organic style with hero section, feature grid, testimonials, pricing table, and footer.
```

### 3. 作品集展示

生成 自然有机风风格的作品集页面

```
Create a portfolio showcase page using Natural Organic style with project grid, about section, contact form, and consistent visual language.
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 使用冷色调（蓝、紫除非作为辅助）
- 使用纯黑 #000000
- 使用尖锐的几何形状
- 使用高科技感的设计元素
- 使用霓虹/高饱和度颜色
- 使用完美的圆形/矩形

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
- [ ] 禁止使用冷色调（蓝、紫除非作为辅助）
- [ ] 禁止使用纯黑 #000000
- [ ] 禁止使用尖锐的几何形状
- [ ] 禁止使用高科技感的设计元素
- [ ] 禁止使用霓虹/高饱和度颜色