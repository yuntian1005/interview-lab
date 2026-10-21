import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
let cookie = '';
async function request(path, payload, expected = 200, authenticated = true) {
  const response = await fetch(base + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return response.json();
}

assert.equal((await request('/api/health')).demo, true, 'Run smoke checks in DEMO_MODE=true');
await request('/api/interviews', undefined, 401, false);
await request('/api/auth/register', { username: `demo_${Date.now()}`, password: 'SyntheticDemo2026!' });
const created = await request('/api/interviews', {
  resume_text: '虚构示例：计算机专业学生，使用 Java 和 Spring Boot 完成图书管理项目，负责接口设计、测试与部署。',
  jd_text: '虚构示例：Java 后端实习岗位，需要掌握 Java、SQL、REST API 与测试，能够协作完成项目。',
  question_count: 3,
});
assert.ok(created.session_id);
assert.equal(created.question_plan.length, 3, 'Demo must respect the chosen question count');
let session = await request(`/api/interviews/${created.session_id}`);
assert.equal(session.session.provider, 'mock');
const foreignCookie = cookie;
cookie = '';
await request('/api/auth/register', { username: `other_${Date.now()}`, password: 'SyntheticDemo2026!' });
await request(`/api/interviews/${created.session_id}`, undefined, 404);
cookie = foreignCookie;
let finished = false;
for (let count = 0; count < 24; count++) {
  session = await request(`/api/interviews/${created.session_id}`);
  const turn = await request(`/api/interviews/${created.session_id}/turns`, {
    question_id: session.current_question.question_id,
    answer_text: '在这个虚构项目中，我负责接口设计与测试，先明确目标，再分析数据与需求，和同伴协作实现，并通过测试和复盘检查结果。',
  });
  if (turn.next_action === 'finish_interview') { finished = true; break; }
}
assert.ok(finished, 'Interview must eventually finish');
const report = await request(`/api/interviews/${created.session_id}/report`);
assert.ok(Number.isFinite(report.total_score));
assert.match(report.report_markdown, /Mock/);
console.log('PASS: authentication, account isolation, mock interview, follow-ups and report. Synthetic data only.');
