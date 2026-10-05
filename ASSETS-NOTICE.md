# 素材归属与授权说明（ASSETS-NOTICE）

本插件是**非官方同人作品**，不隶属于 DeepSeek 或鹰角网络（Hypergryph）。

## 代码

插件代码（`index.js` / `client.js` / `src/` / `tools/` / 文档）采用 **MIT 许可**。

## 角色美术与素材（MIT 不覆盖）

以下内容的版权归 **鹰角网络（Hypergryph）** 所有，仅作个人非商业使用：

- `art/avatar.webp` —— 官方透明底聊天头像（`15-头像/聊天头像.webp`）的圆形羽化处理；
- `art/wallpaper-*.webp`（16 张，8 图 × 明暗两版）—— 取自官方公开物料
  （<https://wiki.skland.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1132>
  及官方公开物料）；暗色版与缩略图为本插件工具（`tools/prepare-art.py`）对原图的
  程序化处理；
- `art/contour.webp` —— 等高线纹理，源自官方物料的程序化处理；
- 角色名称、标识及相关商标归其权利人所有。

源素材库 `庄方宜素材\`（394 文件）**不在**发行包内，仅作为本机重建 `art/` 的
输入（`prepare-art.py` 只读取、不修改源素材）。

## 配色

4 套预设的配色值是对官方公开物料的**量化提取**（取色 + 色度模型再调校，
见 `src/palette.js` 与 `README.md` 的配色章节）。色值本身是数据，但请勿
将本插件整体表述为官方产品。

## 参考实现

- [Mornye-Observation-Skin](https://github.com/is-limo/Mornye-Observation-Skin)（**MIT**）
  —— 本插件的设计参考了它的：`data-plugin-css` 哈希反查定位、会话状态推导优先级、
  「原生面板展开时让位」策略、隐私边界标准。已在代码注释与 `README.md` 对照表中
  逐处署名。未复制其美术资源（它使用另一角色「莫宁」的素材）。
- DeepSeek Harness 为第三方程序，本插件通过其官方插件接口工作，**不修改**
  `app.asar` 与官方程序文件。

## 免责声明

- 本插件与 DeepSeek、鹰角网络均无关联；
- 若权利人认为本插件的个人非商业使用场景需要下架，请开 issue，将立即移除相关素材。
