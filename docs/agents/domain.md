# Domain Docs

本仓库采用 single-context 布局：

- 根目录 CONTEXT.md：领域概念和术语。
- docs/adr/：架构决策记录。

## 探索代码前

读取 CONTEXT.md，以及 docs/adr/ 中与当前工作相关的 ADR。

文件不存在时直接继续。
领域术语或决策实际明确后，由 /domain-modeling 按需创建文档。

## 使用领域术语

Issue 标题、设计方案、假设和测试名称涉及领域概念时，
采用 CONTEXT.md 中定义的术语。

遇到尚未定义的概念，先检查是否可以使用已有术语；
确有缺口时，记录为 /domain-modeling 的输入。

## 处理 ADR 冲突

方案与现有 ADR 冲突时，明确列出 ADR 编号、冲突内容和重新讨论的理由，
由后续决策处理。
