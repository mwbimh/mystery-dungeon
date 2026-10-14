/* 剧情数据。改台词只需要改这个文件。
 *
 * cast：角色 id → { name 显示名, img 默认立绘, side 默认站位 left/right,
 *                   faces 差分表 { smile: "路径", ... },
 *                   faceDir 差分约定目录（faces 里没写的表情找 <faceDir><表情>.webp），
 *                   face 默认表情 }
 *   差分找不到时自动退回默认立绘。
 * scenes：每段剧情
 *   id      唯一 id（记录是否看过）
 *   on      触发条件 { event: "town"|"npc"|"floor", npc, floor, after: "death"|"clear", once, requires }
 *   cast    开场就站在台上的角色
 *   lines   台词：
 *             ["kimi", "台词"]              角色说话（第三项可写 "left"/"right" 指定站位）
 *             ["kimi:smile", "台词"]        带表情差分说话（也可写第三项 { face: "smile", pos: "left" }）
 *             { show: "kimi:angry", pos }   只换表情/上场，不说话
 *             [null, "旁白"]
 *             { choice: [["选项文字", "跳到的 label"], ...] }
 *             { label: "a" }  { goto: "b" }  { goto: "end" }  { leave: "kimi" }
 * 检查数据：浏览器控制台运行 MD.story.validate()
 */
(function (global) {
  const MD = global.MD || (global.MD = {});
  const P = "assets/runtime/portraits/";

  MD.storyData = {
    cast: {
      deepseek: { faceDir: P + "deepseek/", name: "DeepSeek", img: P + "deepseek.webp", side: "left" },
      kimi: { faceDir: P + "kimi/", name: "Kimi", img: P + "kimi.webp", side: "right" },
      claude: { faceDir: P + "claude/", name: "Claude", img: P + "claude.webp", side: "right" },
      gpt: { faceDir: P + "gpt/", name: "GPT", img: P + "gpt.webp", side: "right" },
      glm: { faceDir: P + "glm/", name: "GLM", img: P + "glm.webp", side: "right" },
      harness: { faceDir: P + "harness/", name: "Harness", img: P + "harness.webp", side: "right" },
    },

    scenes: [
      {
        id: "intro",
        on: { event: "town", once: true },
        lines: [
          [null, "镇子东边的老井旁，有一道通往地下的石阶。大家管它叫「不可思议的迷宫」——每次走进去，里面的路都不一样。"],
          ["kimi", "早呀，DeepSeek！今天也要下去吗？"],
          ["deepseek", "嗯。上次走到第三层就饿得走不动了……这次我多带了饭团。"],
          ["kimi", "光带饭团可不够哦。迷宫里捡到的东西要多留意，说不定哪样就能救急。"],
          { choice: [["「比如什么？」", "ask"], ["「我心里有数啦。」", "sure"]] },
          { label: "ask" },
          ["kimi", "比如石头。看着没用，扔出去能打到远处的怪。还有睡眠草，实在打不过，就让它先睡一会儿。"],
          ["deepseek", "石头……我记住了。"],
          { goto: "out" },
          { label: "sure" },
          ["kimi", "真的？上次是谁背了一包蘑菇回来的？"],
          ["deepseek", "……那是意外。"],
          { label: "out" },
          ["kimi", "总之，打不过就跑。背包丢了也没关系，仓库里的东西还在，人平安回来就好。"],
          ["deepseek", "知道啦。我出发了！"],
        ],
      },
      {
        id: "floor4-forest",
        on: { event: "floor", floor: 4, once: true },
        lines: [
          [null, "石阶尽头忽然亮了起来。头顶看不见天空，四周却长满了树。"],
          ["deepseek", "迷宫里……怎么会有森林？"],
          ["deepseek", "树枝上挂着圆圆的果子，看起来有点像饭团。"],
          { choice: [["摘一个尝尝", "eat"], ["还是别乱碰了", "skip"]] },
          { label: "eat" },
          ["deepseek", "……是叶子裹着的泥巴。呸、呸。"],
          { goto: "go" },
          { label: "skip" },
          ["deepseek", "Kimi 说过，迷宫里来路不明的东西不能乱吃。"],
          { label: "go" },
          ["deepseek", "往前走吧。楼梯应该就在附近。"],
        ],
      },
    ],
  };
})(typeof window !== "undefined" ? window : globalThis);
