# 萨拉托加作业练度分析与培养清单

这是一个纯静态的 GitHub Pages 站点，用于对比你的森空岛干员练度与作业站上传者「萨拉托加」（uploaderId=7661）的作业要求，输出一份从高到低的培养优先级清单。

## 在线使用

1. 打开页面，等待作业数据加载完成（默认实时拉取，失败时自动回退到仓库内快照）。
2. 登录森空岛官网后，按 F12 打开开发者工具，在 Console 中执行：

```js
copy(localStorage.getItem("SK_OAUTH_CRED_KEY")+","+localStorage.getItem("SK_TOKEN_CACHE_KEY"))
```

3. 将复制的 cred,token 粘贴到页面输入框，点击「获取账号列表」。
4. 选择你的明日方舟账号，页面会自动读取干员练度并生成清单。

也可以使用「手动导入 JSON」或「载入示例」体验。

## 手动导入格式

支持以下任意一种：

1. JSON 数组（字段与森空岛格式化后的干员数据一致：name、elite、level、skill1、skill2、skill3、maxModuleLevel）：

```json
[
  {
    "name": "阿米娅",
    "elite": 2,
    "level": 60,
    "skill1": 7,
    "skill2": 10,
    "skill3": 10,
    "maxModuleLevel": 1
  }
]
```

2. 包含 operators 数组的对象。

3. 森空岛 player/info 接口的原始响应（含 data.chars，干员字段为 charId、evolvePhase、level、mainSkillLvl、skills[].specializeLevel、equip[].level），例如 curl 或脚本直接保存的接口返回：

```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "chars": [
      {
        "charId": "char_002_amiya",
        "evolvePhase": 2,
        "level": 60,
        "mainSkillLvl": 7,
        "skills": [{ "specializeLevel": 0 }],
        "equip": [{ "level": 1, "locked": false }]
      }
    ]
  }
}
```

## 判定规则

- 作业中的 opers 是必须满足的干员槽位；groups 是任选其一的干员组。
- 精英化要求会同时考虑显式 elite 与隐含要求：技能 2 至少精一、技能 3 至少精二；技能等级大于 7 或模组大于 0 时至少精二。
- 等级与技能等级按作业 requirements 比较；skill 为 0 时不检查技能等级。
- 模组默认不纳入「是否可抄」硬判定，只作为额外信息展示；可勾选「模组计入判定」。

## 优先级算法

对每个干员计算边际收益：

- coreGain：当前不可抄作业中，把该干员练满后变为可抄，且其作为必带干员出现的数量。
- groupGain：同上，但该干员只出现在组内。
- unsatisfiedCore：作为必带干员且未达标的不可抄作业数。
- recentCoreDemand：近 90 天作业中作为必带干员出现的次数。
- groupDemand：作为组内候选出现的次数。

分数为：

```text
score = coreGain * 1000 + groupGain * 100 + unsatisfiedCore * 50 + recentCoreDemand * 10 + groupDemand
```

分数从高到低排序，同分按缺口总量升序、再按干员名排序。

## 开发

要求 Node.js 20 及以上。

```bash
npm install
npm test              # 运行 Vitest 并强制 100% 覆盖率
npm run test:watch    # 监听模式
npm run generate:data # 重新生成 data/ 下的数据文件
```

## 数据来源与隐私

- 作业数据：PRTS 作业站 API（https://prts.maa.plus）。
- 干员数据：森空岛（https://zonai.skland.com），仅在浏览器内直连。
- 干员头像与技能图标：一图流 CDN（https://cos.yituliu.cn）。
- 森空岛 cred/token 仅保存在当前页面内存中，默认不写入 localStorage，不会上传到本站或其他第三方。

## GitHub Pages 部署

仓库包含 .github/workflows/pages.yml，push 到 master 后会自动运行测试并部署到 GitHub Pages。

也可以使用传统方式：仓库 Settings → Pages → Deploy from branch → master / (root)。
