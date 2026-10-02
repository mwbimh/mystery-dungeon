/* Town conversations are data only. Copy dialogue.js/css separately to reuse the UI. */
(function (global) {
  'use strict';
  const portrait = name => 'assets/runtime/ui/town/' + name + '-idle.png';
  const scenes = {
    ChatGPT: {
      id: 'town-chatgpt', title: '路标旁 · 第一声问候', speaker: 'ChatGPT', role: '旅路向导', portrait: portrait('chatgpt'), start: 'hello',
      nodes: {
        hello: { text: '来得正好。我刚把路标上的灰擦干净。\n第一次走这条路？不用急着出发，先问问你最在意的事。', choices: [
          { id: 'first-trip', label: '第一次出发，应该先留意什么？', next: 'first-trip' },
          { id: 'route', label: '这两处迷宫有什么不同？', next: 'route' },
          { id: 'bye', label: '我准备好了，回头见' }
        ] },
        'first-trip': { text: '先看饱腹度，再看前方的路。饭团要留到需要的时候，危险靠近时，手里的道具也能帮你。\n迷宫会等你落下这一步，再走它的下一步。慢慢想，没关系。', next: 'ready' },
        route: { text: '在镇子的迷宫栏可以查看路线说明。想先熟悉脚步，就看看练习用的林地；想走得更远，再选那条长路。\n每次出发都从第一层开始，途中不能换路线。', next: 'ready' },
        ready: { text: '出发前，再看一眼背包吧。等你回到这盏灯下，我们再交换沿途的见闻。', choices: [
          { id: 'again', label: '我还有一件事想问', next: 'hello' },
          { id: 'done', label: '嗯，等我回来' }
        ] }
      }
    },
    Claude: {
      id: 'town-claude', title: '灯下书桌 · 旅途的留白', speaker: 'Claude', role: '灯下记录员', portrait: portrait('claude'), start: 'hello',
      nodes: {
        hello: { text: '我替这座镇子记下了许多归来的脚步。\n纸上还有一页空白，留给你的下一次冒险。今天想聊些什么？', choices: [
          { id: 'save', label: '我的旅途会被记住吗？', next: 'save' },
          { id: 'loss', label: '如果没能走到出口呢？', next: 'loss' },
          { id: 'bye', label: '先把这一页留白吧' }
        ] },
        save: { text: '每个存档位都有独立的旅程。菜单里可以继续、读取，也能把存档下载留作备份。\n镇子的灯会记住你。不过换设备或清理浏览器前，记得带走自己的备份。', next: 'ending' },
        loss: { text: '倒下后，你会回到镇子，随身的背包和装备会丢失；留在仓库里的物品仍在。\n平安走到最后的出口，才能把旅途中的收获带回来。', next: 'ending' },
        ending: { text: '空白也很好。它意味着，这个故事还有地方可以继续。', choices: [
          { id: 'again', label: '再问一件事', next: 'hello' },
          { id: 'done', label: '那就，下一页见' }
        ] }
      }
    },
    Kimi: {
      id: 'town-kimi', title: '树影小径 · 风里的消息', speaker: 'Kimi', role: '巡路信使', portrait: portrait('kimi'), start: 'hello',
      nodes: {
        hello: { text: '嘘，听到了吗？树叶在替我报路。\n我刚绕着镇子跑了一圈，正好有两条小消息想带给远行的人。', choices: [
          { id: 'movement', label: '有什么赶路的窍门？', next: 'movement' },
          { id: 'waiting', label: '能在迷宫里停一会儿吗？', next: 'waiting' },
          { id: 'bye', label: '下次再听你的消息' }
        ] },
        movement: { text: '方向键或 WASD 都能走，按住 Shift 加方向可以冲刺。遇到岔路、物品或危险时，脚步会停下来。\n赶路虽快，陌生的拐角还是慢一点好。', next: 'ending' },
        waiting: { text: '当然。你不行动时，可以慢慢观察。按空格则会主动等待一回合，周围的怪物也会行动。\n停下来想一想，和把这一回合让出去，是两回事哦。', next: 'ending' },
        ending: { text: '愿下一阵风带来好消息。回来时，记得告诉我哪一段路最漂亮。', choices: [
          { id: 'again', label: '另一条消息是什么？', next: 'hello' },
          { id: 'done', label: '好，一言为定' }
        ] }
      }
    },
    GLM: {
      id: 'town-glm', title: '工坊门前 · 工具的脾气', speaker: 'GLM', role: '工坊看守', portrait: portrait('glm'), start: 'hello',
      nodes: {
        hello: { text: '锤子先歇一歇，和我聊聊你的行囊吧。\n用对手里的东西，往往比多带几件更重要。', choices: [
          { id: 'tools', label: '击退之杖和石头怎么用？', next: 'tools' },
          { id: 'food', label: '饭团和睡眠草也能放进技能栏吗？', next: 'food' },
          { id: 'bye', label: '我先去整理行囊' }
        ] },
        tools: { text: '打开背包，选择道具就能查看可用的操作。击退之杖和石头还可以拖到主动栏，按住后向外拖动来瞄准。\n记得看清方向，工具不会替你决定目标。', next: 'ending' },
        food: { text: '饭团和睡眠草要在背包里使用，不能放进主动栏。\n物品各有自己的用法，先看清操作，再下决定。', next: 'ending' },
        ending: { text: '今天的工坊先教你认工具。愿你带着完整的行囊回来，我们再慢慢聊。', choices: [
          { id: 'again', label: '再讲讲另一种道具', next: 'hello' },
          { id: 'done', label: '记住了，谢谢' }
        ] }
      }
    },
    'DeepSeek Harness': {
      id: 'town-harness', title: '广场长椅 · 出发前的一分钟', speaker: 'Harness', role: '出发整备员', portrait: portrait('harness'), start: 'hello',
      nodes: {
        hello: { text: '出发前一分钟，值得用来检查一遍。\n路线、背包、退路。你想先确认哪一件？', choices: [
          { id: 'route', label: '路线怎么选？', next: 'route' },
          { id: 'pack', label: '帮我过一遍出发清单', next: 'pack' },
          { id: 'bye', label: '一切就绪' }
        ] },
        route: { text: '回到镇子的路线栏，选好迷宫再出发。走进上方的入口，或按“开始新冒险”，都会从所选路线的第一层开始。\n一旦进入迷宫，就要沿着这条路线继续。', next: 'ending' },
        pack: { text: '看看背包还有没有空位，把暂时用不上的东西留在仓库；再确认主动栏和所选迷宫。\n途中没有随时回镇的捷径，最后一层的出口才是归路。', next: 'ending' },
        ending: { text: '检查完毕。不需要走得最快，只要下一步是你自己选的。', choices: [
          { id: 'again', label: '还有一项要确认', next: 'hello' },
          { id: 'warehouse', label: '先去看看仓库', action: 'warehouse' },
          { id: 'done', label: '这就出发' }
        ] }
      }
    },
    DeepSeek: {
      id: 'town-deepseek', title: '归途仓库 · 留一盏灯', speaker: 'DeepSeek', role: '仓库管家', portrait: portrait('deepseek'), start: 'hello',
      nodes: {
        hello: { text: '欢迎回来。架子上的空位还替你留着。\n要把收获存好，还是拿上补给再走一趟？', choices: [
          { id: 'warehouse', label: '打开仓库，整理物品', action: 'warehouse' },
          { id: 'storage', label: '存进来就不会丢了吗？', next: 'storage' },
          { id: 'bye', label: '只是来打声招呼' }
        ] },
        storage: { text: '同一个存档里的仓库会一直保留，冒险中倒下也不会丢掉这里的物品。\n只有回到镇子才能存取，迷宫里只能查看。不同存档的架子互不相通。', choices: [
          { id: 'warehouse', label: '那就整理一下', action: 'warehouse' },
          { id: 'done', label: '知道了，下次见' }
        ] }
      }
    }
  };
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(key => freeze(value[key]));
      Object.freeze(value);
    }
    return value;
  }
  freeze(scenes);
  global.MDTownContent = Object.freeze({
    get: name => Object.prototype.hasOwnProperty.call(scenes, name) ? scenes[name] : null,
    names: Object.freeze(Object.keys(scenes)),
    scenes
  });
})(typeof window !== 'undefined' ? window : globalThis);
