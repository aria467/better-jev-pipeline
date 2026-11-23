import type { ChoiceOption, Question, Scenario, ScoreLevel } from './types'

const option = (name: string, description = ''): ChoiceOption => ({ name, description })
const level = (label: string, description?: string): ScoreLevel => ({ label, description })

const choice = (instructions: string, options: ChoiceOption[]): Question => ({
  type: 'choice',
  instructions,
  options,
})
const score = (instructions: string, levels: ScoreLevel[]): Question => ({
  type: 'score',
  instructions,
  levels,
})
const noul = (
  instructions: string,
  criteria?: { true?: string; false?: string },
): Question => ({ type: 'noul', instructions, ...(criteria ? { criteria } : {}) })

const TICKET =
  '你好，我已经连续 3 天无法连接 Stripe 账户了，集成一直失败。我正在丢失销售额，请尽快帮忙处理！'

const RESUME =
  '候选人：林然。计算机科学本科，5 年后端开发经验。近 3 年负责支付网关与对账系统，主导过一次从单体到微服务的迁移；熟悉 Go、PostgreSQL、Kubernetes。无团队管理经验，但带过 2 名实习生。期望远程办公。'

const JD =
  '高级后端工程师：5 年以上经验；熟悉支付/账务系统；具备分布式系统设计能力；有团队协作与代码评审经验；接受远程。'

const POST =
  '这款耳机音质一般，降噪也吹得太过了。客服三天不回消息，退款流程又绕，真是浪费钱。大家别再买了，想避坑的可以私信我，我有内部渠道价。'

const supportTriage: Scenario = {
  id: 'support-triage',
  name: '客服工单分流',
  description: '先理解工单，再分别判断退款与技术升级，最后汇总处置动作。',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '工单理解',
      state: TICKET,
      includeUpstream: false,
      position: { x: 0, y: 0 },
      questions: {
        department: choice('这个工单应该分配给哪个团队处理？', [
          option('财务', '付款、发票、退款相关问题'),
          option('技术', 'Bug、系统故障、集成问题'),
          option('销售', '定价、账户咨询'),
        ]),
        frustration: score('客户看起来有多沮丧？', [
          level('冷静，只是陈述事实'),
          level('不满但礼貌'),
          level('非常愤怒，言辞激烈'),
        ]),
        urgent: noul('这条消息是否传达了紧急性或时效性？', {
          true: '明确要求尽快处理，或存在持续损失',
          false: '没有时间压力',
        }),
      },
    },
    {
      id: 'n2',
      title: '退款判定',
      state: {
        ticket: TICKET,
        department: '{{n1.department.choice}}',
        frustration: '{{n1.frustration.score}}',
        urgency: '{{n1.urgent.noul}}',
      },
      includeUpstream: true,
      position: { x: 280, y: -260 },
      questions: {
        refund_eligible: noul('该工单是否涉及重复扣款、未提供服务或其他可退款情形？'),
        refund_risk: choice('退款处理的风险等级如何？', [
          option('可直接退款', '事实清楚，金额与订单可核对'),
          option('需人工核账', '涉及多笔扣款或金额不一致'),
          option('不符合退款条件', '不满足退款政策'),
        ]),
      },
    },
    {
      id: 'n3',
      title: '技术升级判定',
      state: {
        ticket: TICKET,
        department: '{{n1.department.choice}}',
        frustration: '{{n1.frustration.score}}',
        urgency: '{{n1.urgent.noul}}',
      },
      includeUpstream: true,
      position: { x: 280, y: 260 },
      questions: {
        needs_engineer: noul('该问题是否需要工程师介入排查集成故障？'),
        severity: score('技术问题的严重程度如何？', [
          level('可自助解决', '有明确文档或已知排查步骤'),
          level('需要支持协助', '需要人工排查配置'),
          level('需要紧急升级', '影响生产环境或持续造成损失'),
        ]),
      },
    },
    {
      id: 'n4',
      title: '处置汇总',
      state: {
        ticket: TICKET,
        department: '{{n1.department.choice}}',
        refund: '{{n2.refund_eligible.noul}}',
        refund_risk: '{{n2.refund_risk.choice}}',
        needs_engineer: '{{n3.needs_engineer.noul}}',
        severity: '{{n3.severity.score}}',
      },
      includeUpstream: true,
      position: { x: 560, y: 0 },
      questions: {
        action: choice('下一步应该采取什么处置动作？', [
          option('自动回复', '可套用标准答复，无需人工'),
          option('人工跟进', '需要客服人工确认细节'),
          option('升级主管', '涉及退款争议或重大技术故障'),
        ]),
        reply_tone: score('回复应采用什么语气？', [
          level('简洁中立'),
          level('共情安抚'),
          level('正式严肃'),
        ]),
        needs_review: noul('该工单是否需要人工复核后再回复？'),
      },
    },
  ],
  edges: [
    { id: 'e-n1-n2', source: 'n1', target: 'n2' },
    { id: 'e-n1-n3', source: 'n1', target: 'n3' },
    { id: 'e-n2-n4', source: 'n2', target: 'n4' },
    { id: 'e-n3-n4', source: 'n3', target: 'n4' },
  ],
}

const resumeScreen: Scenario = {
  id: 'resume-screen',
  name: '简历初筛',
  description: '线性三步：岗位匹配、经验评估、面试建议，后一步引用前一步结论。',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '岗位匹配',
      state: { resume: RESUME, job_description: JD },
      includeUpstream: false,
      position: { x: 0, y: 0 },
      questions: {
        match: choice('候选人与岗位的整体匹配度如何？', [
          option('高度匹配', '核心要求基本满足'),
          option('部分匹配', '满足部分关键要求，存在明显缺口'),
          option('不匹配', '关键要求缺失'),
        ]),
        must_have: noul('候选人是否满足岗位的硬性要求（5 年以上后端经验、支付/账务背景）？'),
      },
    },
    {
      id: 'n2',
      title: '经验评估',
      state: {
        resume: RESUME,
        job_description: JD,
        match: '{{n1.match.choice}}',
        must_have: '{{n1.must_have.noul}}',
      },
      includeUpstream: true,
      position: { x: 280, y: 0 },
      questions: {
        years: score('相关后端经验处于哪个档位？', [
          level('不足 1 年'),
          level('1–3 年'),
          level('3–5 年'),
          level('5 年以上'),
        ]),
        leadership: noul('候选人是否有团队管理或技术带教经历？'),
        risk: choice('简历中是否存在需要面试核实的风险点？', [
          option('无', '经历与岗位直接对应'),
          option('需核实远程协作', '长期远程，需确认协作习惯'),
          option('需核实管理经验', '管理经历较弱'),
        ]),
      },
    },
    {
      id: 'n3',
      title: '面试建议',
      state: {
        resume: RESUME,
        job_description: JD,
        match: '{{n1.match.choice}}',
        years: '{{n2.years.score}}',
        leadership: '{{n2.leadership.noul}}',
        risk: '{{n2.risk.choice}}',
      },
      includeUpstream: true,
      position: { x: 560, y: 0 },
      questions: {
        recommendation: choice('是否推进到面试？', [
          option('建议面试', '值得投入面试资源'),
          option('备选', '可与更强的候选人比较后再定'),
          option('不推进', '不满足当前岗位要求'),
        ]),
        interview_focus: choice('面试应重点考察什么？', [
          option('系统设计', '分布式与支付系统设计能力'),
          option('协作与远程', '远程协作与沟通习惯'),
          option('管理潜力', '带教与管理潜力'),
        ]),
        need_portfolio: noul('是否需要候选人提供过往项目材料或代码样例？'),
      },
    },
  ],
  edges: [
    { id: 'e-n1-n2', source: 'n1', target: 'n2' },
    { id: 'e-n2-n3', source: 'n2', target: 'n3' },
  ],
}

const contentReview: Scenario = {
  id: 'content-review',
  name: '内容审核流转',
  description: '先分类，再并行做严重度与违规判定，最后汇总处置动作。',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '风险分类',
      state: POST,
      includeUpstream: false,
      position: { x: 0, y: 0 },
      questions: {
        category: choice('这条内容主要属于哪一类？', [
          option('正常内容', '真实体验分享或正常讨论'),
          option('广告营销', '导流、私信报价、未披露的商业推广'),
          option('人身攻击', '针对个人的侮辱或威胁'),
          option('违法风险', '涉及违法交易或危险行为'),
        ]),
        contains_pii: noul('内容中是否包含手机号、地址、身份证号等个人敏感信息？'),
      },
    },
    {
      id: 'n2',
      title: '严重度评估',
      state: { post: POST, category: '{{n1.category.choice}}', pii: '{{n1.contains_pii.noul}}' },
      includeUpstream: true,
      position: { x: 280, y: -260 },
      questions: {
        severity: score('违规严重度处于哪个等级？', [
          level('可忽略', '轻微措辞问题'),
          level('低', '需要提醒但不影响展示'),
          level('中', '需要限流或折叠'),
          level('高', '需要删除并记录'),
        ]),
        needs_human: noul('是否需要人工审核而不是自动处置？'),
      },
    },
    {
      id: 'n3',
      title: '违规判定',
      state: { post: POST, category: '{{n1.category.choice}}', pii: '{{n1.contains_pii.noul}}' },
      includeUpstream: true,
      position: { x: 280, y: 260 },
      questions: {
        violates: noul('这条内容是否违反了社区规范？'),
        policy: choice('如果违规，主要违反哪条规范？', [
          option('不违规', '未发现明确违规点'),
          option('商业推广', '未披露的商业导流'),
          option('攻击辱骂', '针对个人或群体的攻击'),
          option('隐私泄露', '包含个人敏感信息'),
        ]),
      },
    },
    {
      id: 'n4',
      title: '处置建议',
      state: {
        post: POST,
        category: '{{n1.category.choice}}',
        severity: '{{n2.severity.score}}',
        needs_human: '{{n2.needs_human.noul}}',
        violates: '{{n3.violates.noul}}',
        policy: '{{n3.policy.choice}}',
      },
      includeUpstream: true,
      position: { x: 560, y: 0 },
      questions: {
        action: choice('建议采取什么处置？', [
          option('放行', '正常展示'),
          option('限流', '降低分发，不删除'),
          option('删除', '移除内容并通知作者'),
          option('上报', '转交安全或法务团队'),
        ]),
        appealable: noul('该处置是否应当允许作者申诉？'),
      },
    },
  ],
  edges: [
    { id: 'e-n1-n2', source: 'n1', target: 'n2' },
    { id: 'e-n1-n3', source: 'n1', target: 'n3' },
    { id: 'e-n2-n4', source: 'n2', target: 'n4' },
    { id: 'e-n3-n4', source: 'n3', target: 'n4' },
  ],
}

const REFUND =
  '订单 #A20418，金额 688 元。客户留言：耳机到货后右耳无声，已拍照并上传。希望直接退款，不想换货，已经等了三天，请尽快处理。这是本月第二次联系客服。'

const refundGate: Scenario = {
  id: 'refund-gate',
  name: '退款审批',
  description:
    '先理解退款申请，再用逻辑步根据金额与风险分数自动分流：低风险直接答复，高风险进入人工复核。',
  model: 'jev-latest',
  nodes: [
    {
      id: 'n1',
      title: '退款申请理解',
      state: REFUND,
      includeUpstream: false,
      position: { x: 0, y: 0 },
      questions: {
        reason: choice('退款的主要原因是什么？', [
          option('商品质量问题', '功能故障、损坏、与描述不符'),
          option('物流破损', '运输过程中造成的损坏'),
          option('不喜欢/不想要', '无质量问题，仅主观原因'),
          option('其他', '无法归入以上类别'),
        ]),
        risk: score('这笔退款的风险有多高？', [
          level('低', '事实清楚、金额不大、首次申请'),
          level('中', '需要核对订单或存在多次联系'),
          level('高', '金额较大、理由可疑或反复退款'),
        ]),
        high_value: noul('这笔退款的订单金额是否超过 500 元？', {
          true: '订单金额明显超过 500 元',
          false: '订单金额低于或接近 500 元',
        }),
      },
    },
    {
      id: 'n2',
      kind: 'logic',
      title: '自动分流',
      position: { x: 280, y: 0 },
      outputs: [
        {
          id: 'auto_pass',
          expression:
            '{{n1.high_value.noul}} < 0.4 AND {{n1.risk.score}} < 0.5 AND {{n1.reason.choice}} != "其他"',
        },
        {
          id: 'manual_review',
          expression: '{{n1.high_value.noul}} >= 0.6 OR {{n1.risk.score}} >= 1.5',
        },
      ],
    },
    {
      id: 'n3',
      title: '人工复核',
      state: {
        ticket: REFUND,
        reason: '{{n1.reason.choice}}',
        risk: '{{n1.risk.score}}',
        high_value: '{{n1.high_value.noul}}',
      },
      includeUpstream: true,
      position: { x: 560, y: -260 },
      questions: {
        decision: choice('人工复核后应如何处理？', [
          option('通过退款', '风险可控，可直接退款'),
          option('拒绝退款', '不符合退款政策'),
          option('补充材料', '需要客户提供更多凭证'),
        ]),
        followup: noul('是否需要向客户追加提问后再决定？'),
      },
    },
    {
      id: 'n4',
      title: '自动答复草稿',
      state: {
        ticket: REFUND,
        reason: '{{n1.reason.choice}}',
        high_value: '{{n1.high_value.noul}}',
      },
      includeUpstream: true,
      position: { x: 560, y: 260 },
      questions: {
        reply: choice('自动答复应采用哪种处理动作？', [
          option('标准同意退款', '低风险且理由清晰'),
          option('请求补充信息', '需要订单号或照片'),
          option('转人工', '自动流程无法覆盖'),
        ]),
        tone: score('答复语气应如何？', [
          level('简洁中立'),
          level('共情安抚'),
          level('正式严肃'),
        ]),
      },
    },
  ],
  edges: [
    { id: 'e-n1-n2', source: 'n1', target: 'n2' },
    {
      id: 'e-n2-n3',
      source: 'n2',
      target: 'n3',
      when: { output: 'manual_review', equals: true },
    },
    {
      id: 'e-n2-n4',
      source: 'n2',
      target: 'n4',
      when: { output: 'auto_pass', equals: true },
    },
  ],
}

export const PRESETS: Scenario[] = [supportTriage, resumeScreen, contentReview, refundGate]

export const DEFAULT_SCENARIO: Scenario = supportTriage
