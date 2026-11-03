STYLEKIT_STYLE_REFERENCE
style_name: 便当盒布局
style_slug: bento-grid
style_source: /styles/bento-grid

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

你是一个 Bento Grid 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 禁止所有卡片大小相同（失去 Bento 特色）
- 禁止间隙不一致
- 禁止卡片过于拥挤无留白
- 禁止忽略响应式适配
- 禁止在卡片内堆砌过多内容
- 禁止使用直角（需要圆角）

## 必须遵守

- 使用 CSS Grid 布局 grid grid-cols-4
- 卡片跨越多行或多列 col-span-2, row-span-2
- 保持一致的间隙 gap-4 或 gap-6
- 使用圆角 rounded-xl 或 rounded-2xl
- 大卡片放置主要内容，小卡片放置次要信息
- 使用 aspect-ratio 保持卡片比例
- 悬停时平滑上浮 + 微放大 hover:-translate-y-1 hover:scale-[1.01]
- 悬停时阴影从紧凑变宽广（shadow-sm -> shadow-xl）
- 卡片内图标在 group-hover 时独立变色或 scale-110
- 使用类弹簧缓动 ease-out，duration-200 到 300

## Animation & Interaction Rules

- Widget Feel: 每个卡片如独立 iOS 小组件。悬停时平滑上浮 + 微放大（hover:-translate-y-1 hover:scale-[1.01]），配合柔和宽广阴影（hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]）。
- Micro-interactions: 卡片内图标在 group-hover 时独立响应：变色（bg swap）、放大（scale-110）。
- Snappy Easing: 使用 ease-out 配合 duration-200 到 duration-300，让交互灵敏且现代。
- Active Feedback: 按下时 active:scale-95 或 active:scale-98，模拟物理按压。
- Smooth Focus: 输入框聚焦时 ring 过渡极度平滑（transition-all duration-200）。

## 布局规则

大卡片 (col-span-2 row-span-2):
- 放置主要内容或特色功能
- 可使用渐变背景
- 建议 1-2 个

中卡片 (col-span-2 或 row-span-2):
- 次要重要内容
- 建议 2-3 个

小卡片 (1x1):
- 图标、数字、标签等简短内容
- 填充剩余空间

## 配色建议

背景:
- 渐变: bg-gradient-to-br from-blue-500 to-purple-600
- 浅色: bg-zinc-50, bg-zinc-100
- 彩色: bg-orange-50, bg-green-50, bg-blue-50

文字:
- 主要: text-zinc-900
- 次要: text-zinc-500, text-zinc-600
- 白色: text-white (在深色背景上)

## 自检

每次生成代码后检查：
1. 有大小不一的卡片
2. 使用了 CSS Grid
3. 间隙一致
4. 有响应式处理
5. 圆角统一
6. 卡片有 hover 上浮 + 微放大效果
7. 内部图标有 group-hover 联动

---

# Bento Grid (便当盒布局) Design System

> 灵感源于日式便当盒的不规则网格布局，通过大小不一的卡片组合创造视觉层次，常用于作品集和产品展示。

## 核心理念

Bento Grid（便当盒布局）是一种源于日式便当盒分隔设计的现代布局风格。通过不同尺寸的卡片在网格中的组合排列，创造出既有秩序又富有变化的视觉效果。

核心理念：
- 模块化：每个区块独立但相互关联
- 层次感：通过尺寸差异突出重点内容
- 留白：适当间隙让布局呼吸
- 响应式：在不同屏幕上优雅适配
- Widget 把玩感：每张卡片如独立的 iOS 小组件

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
颜色: border-zinc-100 dark:border-zinc-800
圆角: rounded-2xl
```

### 阴影
```
小: shadow-sm
中: shadow-md
大: shadow-lg
悬停: hover:shadow-md hover:-translate-y-0.5
聚焦: focus:shadow-md focus:ring-2 focus:ring-blue-500/20
```

### 交互效果
```
悬停位移: hover:-translate-y-0.5
悬停缩放: （无）
悬停透明度: （无）
过渡动画: transition-all duration-200
按下状态: active:scale-95
```

### 字体
```
标题: font-semibold text-zinc-900 dark:text-zinc-100
正文: text-zinc-600 dark:text-zinc-400
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
Section: py-12 md:py-16 lg:py-20
容器: px-4 md:px-6 lg:px-8
卡片: p-4 md:p-6
小间距: gap-3 md:gap-4
中间距: gap-4 md:gap-6
大间距: gap-6 md:gap-8
```

### 颜色角色
```
背景主色: bg-white dark:bg-zinc-900
背景辅色: bg-zinc-50 dark:bg-zinc-800
背景强调色: bg-gradient-to-br from-blue-500 to-purple-600, bg-gradient-to-br from-orange-400 to-pink-500, bg-gradient-to-br from-green-400 to-cyan-500
正文主色: text-zinc-900 dark:text-zinc-100
正文辅色: text-zinc-600 dark:text-zinc-400
正文弱化色: text-zinc-400 dark:text-zinc-500
按钮主色: bg-zinc-900 text-white dark:bg-white dark:text-zinc-900
按钮辅色: bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100
```

---

## [FORBIDDEN] 绝对禁止

以下 class 在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class
- `rounded-none`
- `rounded-sm`
- `gap-1`
- `gap-2`
- `gap-10`
- `gap-12`

### 禁止的模式
- 匹配 `^rounded-none`
- 匹配 `^rounded-sm`

### 禁止原因
- `rounded-none`: Bento Grid requires rounded corners (rounded-xl, rounded-2xl, or rounded-3xl)
- `rounded-sm`: Bento Grid uses larger rounded corners for modern look
- `gap-1`: Bento Grid uses consistent medium gaps (gap-4 or gap-6)

> WARNING: 如果你的代码中包含以上任何 class，必须立即替换。

---

## [REQUIRED] 必须包含

### 按钮必须包含
```
rounded-xl
font-medium
transition-all
```

### 卡片必须包含
```
rounded-2xl
border
border-zinc-100
shadow-sm
transition-all
duration-300
```

### 输入框必须包含
```
bg-zinc-50
border
border-zinc-200
rounded-xl
focus:outline-none
focus:ring-2
focus:ring-blue-500/20
focus:border-blue-500
transition-all
```

---

## [COMPARE] Bento Grid 错误 vs 正确对比

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
<button class="rounded-xl font-medium transition-all bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
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
<div class="rounded-2xl border border-zinc-100 shadow-sm transition-all duration-300 p-4 md:p-6">
  <h3 class="font-semibold text-zinc-900 dark:text-zinc-100 text-xl md:text-2xl">{TITLE}</h3>
</div>
```

### 输入框

[WRONG] **错误示例**（未经当前风格适配的通用输入框）：
```html
<input class="{GENERIC_LIBRARY_INPUT_DEFAULT}" />
```

[CORRECT] **正确示例**（使用当前风格的 input token）：
```html
<input class="bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="{PLACEHOLDER}" />
```

---

## [TEMPLATES] Bento Grid 页面骨架模板

以下骨架只使用当前风格的 token。替换 `{PLACEHOLDER}` 时，不要移除或替换这些 token：

### 导航栏骨架
```html
<nav class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-100 dark:border-zinc-800 px-4 md:px-6 lg:px-8">
  <div class="flex items-center justify-between max-w-6xl mx-auto gap-4 md:gap-6">
    <a href="/" class="font-semibold text-zinc-900 dark:text-zinc-100 text-xl md:text-2xl">
      {LOGO_TEXT}
    </a>
    <div class="flex gap-4 md:gap-6 text-zinc-600 dark:text-zinc-400 text-xs">
      {NAV_LINKS}
    </div>
  </div>
</nav>
```

### Hero 区块骨架
```html
<section class="bg-gradient-to-br from-blue-500 to-purple-600 text-zinc-900 dark:text-zinc-100 py-12 md:py-16 lg:py-20 px-4 md:px-6 lg:px-8">
  <div class="max-w-4xl mx-auto">
    <h1 class="font-semibold text-zinc-900 dark:text-zinc-100 text-4xl md:text-5xl lg:text-6xl">
      {HEADLINE}
    </h1>
    <p class="text-zinc-600 dark:text-zinc-400 text-sm md:text-base max-w-xl">
      {SUBHEADLINE}
    </p>
    <button class="rounded-xl font-medium transition-all bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
      {CTA_TEXT}
    </button>
  </div>
</section>
```

### 卡片网格骨架
```html
<section class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 py-12 md:py-16 lg:py-20 px-4 md:px-6 lg:px-8">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-semibold text-zinc-900 dark:text-zinc-100 text-2xl md:text-3xl">{SECTION_TITLE}</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
      <!-- Card template - repeat for each card -->
      <div class="rounded-2xl border border-zinc-100 shadow-sm transition-all duration-300 p-4 md:p-6">
        <h3 class="font-semibold text-zinc-900 dark:text-zinc-100 text-xl md:text-2xl">{CARD_TITLE}</h3>
        <p class="text-zinc-600 dark:text-zinc-400 text-sm md:text-base text-zinc-400 dark:text-zinc-500">{CARD_DESCRIPTION}</p>
      </div>
    </div>
  </div>
</section>
```

### 表单输入骨架
```html
<input class="bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" placeholder="{PLACEHOLDER}" />
```

### 页脚骨架
```html
<footer class="bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 py-12 md:py-16 lg:py-20 px-4 md:px-6 lg:px-8">
  <div class="max-w-6xl mx-auto">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
      <div>
        <span class="font-semibold text-zinc-900 dark:text-zinc-100 text-xl md:text-2xl">{LOGO_TEXT}</span>
        <p class="text-zinc-600 dark:text-zinc-400 text-xs">{TAGLINE}</p>
      </div>
      <div>
        <h4 class="font-semibold text-zinc-900 dark:text-zinc-100 text-xl md:text-2xl">{COLUMN_TITLE}</h4>
        <ul class="text-zinc-600 dark:text-zinc-400 text-xs">
          {FOOTER_LINKS}
        </ul>
      </div>
    </div>
  </div>
</footer>
```

---

## [CHECKLIST] Bento Grid 生成后自检清单

**输出代码前，逐项验证当前风格的 token 和规则。如有违反，先修正再交付：**

### Token 检查
- [ ] 按钮包含： `rounded-xl font-medium transition-all`
- [ ] 卡片包含： `rounded-2xl border border-zinc-100 shadow-sm transition-all duration-300`
- [ ] 输入框包含： `bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all`

### 禁止项检查
- [ ] 没有使用 `rounded-none`
- [ ] 没有使用 `rounded-sm`
- [ ] 没有使用 `gap-1`
- [ ] 没有使用 `gap-2`
- [ ] 没有使用 `gap-10`
- [ ] 没有使用 `gap-12`

### 风格规则检查
- [ ] 使用 CSS Grid 布局 grid grid-cols-4
- [ ] 卡片跨越多行或多列 col-span-2, row-span-2
- [ ] 保持一致的间隙 gap-4 或 gap-6
- [ ] 使用圆角 rounded-xl 或 rounded-2xl
- [ ] 大卡片放置主要内容，小卡片放置次要信息

### 风格漂移检查
- [ ] 没有违反：禁止所有卡片大小相同（失去 Bento 特色）
- [ ] 没有违反：禁止间隙不一致
- [ ] 没有违反：禁止卡片过于拥挤无留白
- [ ] 没有违反：禁止忽略响应式适配
- [ ] 没有违反：禁止在卡片内堆砌过多内容

### 通用交付检查
- [ ] 响应式布局在手机、平板和桌面下稳定，没有横向溢出
- [ ] 所有交互元素有清晰焦点、可访问名称和 reduced-motion 方案
- [ ] 文本对比度达到 WCAG AA，且没有用颜色单独传递状态
- [ ] 结果仍然能够一眼识别为 Bento Grid

---

## [EXAMPLES] 示例 Prompt

### 1. 功能特性展示

产品功能的 Bento 网格布局

```
用 Bento Grid 风格展示产品的 6 个核心功能，要求：
1. 使用 CSS Grid 创建不规则网格布局
2. 突出功能占据 col-span-2 或 row-span-2
3. 每个卡片包含：图标、标题、简短描述
4. 卡片 hover 时 -translate-y-1 + scale-[1.01] + shadow 扩散
5. 内部图标 group-hover 时变色或 scale-110
6. 响应式：移动端单列，桌面端多列
所有卡片 rounded-2xl，统一 gap-4
```

### 2. 个人主页

个人信息和链接的 Bento 布局

```
用 Bento Grid 风格创建一个个人主页，要求：
1. 大卡片：个人照片 + 简介
2. 社交链接：小方块卡片，各一个图标，hover 时图标 scale-110 变色
3. 技能展示：横向长条卡片
4. 最新项目：中等大小卡片，带缩略图
5. 联系方式：底部全宽卡片
网格布局参考 Apple 风格，卡片 hover 上浮 + 微放大
```

### 3. 数据仪表盘

数据统计卡片的网格布局

```
用 Bento Grid 风格设计一个数据仪表盘，要求：
1. 大卡片：主要图表（占 2x2），hover 时 shadow 扩散
2. 数据卡片：关键指标数字 + 趋势，数字 group-hover 时变色
3. 列表卡片：最近活动或待办事项
4. 小卡片：快捷操作按钮，active:scale-95
5. 全宽卡片：时间线或进度条
使用 CSS Grid，所有卡片 rounded-2xl + hover 微动效
```

## 绝对禁止（匹配即拒绝）

以下模式一旦出现，视为风格违规——不找借口，直接重写。

- 所有卡片大小相同（失去 Bento 特色）
- 间隙不一致
- 卡片过于拥挤无留白
- 忽略响应式适配
- 在卡片内堆砌过多内容
- 使用直角（需要圆角）

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
- [ ] 禁止所有卡片大小相同（失去 Bento 特色）
- [ ] 禁止间隙不一致
- [ ] 禁止卡片过于拥挤无留白
- [ ] 禁止忽略响应式适配
- [ ] 禁止在卡片内堆砌过多内容