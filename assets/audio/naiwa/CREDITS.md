# 奶蛙语音样本来源

`app/assets/audio/naiwa/` 里的 6 个 mp3 全部来自 **Deadlock（死锁）游戏模组「NaiWa 大量出没 (Dynamo)」** 的试听音频，
网址：<https://deadlockskins.gg/mods/naiwa-dynamo-abilities>（原始文件挂在 `assets.deadlockskins.gg`）。

模组把游戏角色 Dynamo 的技能语音换成了奶蛙的梗音，原本 24 条试听里只有前 6 条是真语音，
其余 18 条是 0.24 秒的占位静音，所以只取了前 6 条。对应关系按模组说明页写的技能顺序推断：

| 本地文件 | 原文件 | 时长 | 模组里的位置 | 推断台词 |
| --- | --- | --- | --- | --- |
| `laugh_ult.mp3` | `05-dynamo_singularity_lp.mp3` | 12.07s | 大招（Singularity）循环采样 | 哈哈哈哈哈（招牌大笑） |
| `andi.mp3` | `02-dyanmo_a2_quantum_cast.mp3` | 1.31s | 2 技能 | 安迪 |
| `a1_1.mp3` | `03-dynamo_a1_stomp_prestomp_01.mp3` | 1.07s | 1 技能·语音一 | 丢人不 / 噶酒森（二者之一） |
| `a1_2.mp3` | `04-dynamo_a1_stomp_prestomp_02.mp3` | 1.07s | 1 技能·语音二 | 丢人不 / 噶酒森（二者之一） |
| `a3_1.mp3` | `00-dynamo_a3_heal_cast_01.mp3` | 1.38s | 3 技能·语音一 | 嘎嘎滴辣虾 / 齁辣干巴爹（二者之一） |
| `a3_2.mp3` | `01-dynamo_a3_heal_cast_02.mp3` | 2.09s | 3 技能·语音二 | 嘎嘎滴辣虾 / 齁辣干巴爹（二者之一） |

之所以能确认 `laugh_ult.mp3` 是笑声：在 Chrome 里解码后算了响度包络，
12 秒里有 77 个明显的气口脉冲（≈6.4 次/秒），正是连续「哈哈哈」的节奏；其余几条是 1～2 秒的短句。

## 想换声音

1. 把新的 mp3 丢进 `app/assets/audio/naiwa/`，文件名保持上表左列即可直接替换。
2. 想改播放策略，看 `app/js/app.js` 里的 `playSettlement(stars)`：
   - 5 星：大笑 3.6 秒 → 安迪
   - 4 星：大笑 2.7 秒 → 三技能台词
   - 3 星：一技能台词（丢人不 / 噶酒森）
   - 1~2 星：0.5 音量放 1.5 秒短笑（纯属嘲笑）

找不到文件时不会报错，会自动退回 `app/js/fx.js` 里 WebAudio 现场合成的音效。
