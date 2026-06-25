const TOKEN_KEY = 'bridge-console-token';
let pauseRefresh = false;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showAuthGate();
    throw new Error('未授权');
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2800);
}

function showAuthGate() {
  document.getElementById('auth-gate').classList.remove('hidden');
}

function hideAuthGate() {
  document.getElementById('auth-gate').classList.add('hidden');
}

function table(headers, rows) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function badge(ok, yes = '是', no = '否') {
  return `<span class="badge ${ok ? 'ok' : 'no'}">${esc(ok ? yes : no)}</span>`;
}

function cell(text) {
  return esc(text);
}

async function loadOverview() {
  const data = await api('/api/overview');
  document.getElementById('home-path').textContent = data.home;
  const consoleUrl = data.console
    ? `http://${data.console.host}:${data.console.port}`
    : window.location.origin;
  document.getElementById('overview-cards').innerHTML = `
    <div class="stat-card"><div class="label">Bot 进程</div><div class="value">${esc(data.runningCount)}</div></div>
    <div class="stat-card"><div class="label">Profiles</div><div class="value">${esc(data.profileCount)}</div></div>
    <div class="stat-card"><div class="label">Active Profile</div><div class="value text-sm">${esc(data.activeProfile ?? '—')}</div></div>
    <div class="stat-card"><div class="label">Fleet autoStart</div><div class="value">${esc((data.fleetAutoStart || []).length)}</div></div>
  `;
  document.getElementById('overview-console').innerHTML = `
    <h2 class="panel-title">本 Console（管理界面）</h2>
    <p class="hint">你打开的 <code>${esc(consoleUrl)}</code> 只是管理 API + 网页，<strong>不是</strong> Bot 本身。多开不同 port 只会出现多个 Console，不会多出 Bot 进程。</p>
    <p class="hint">多 Bot 请到 <a href="#fleet">Fleet → 重启 Fleet</a>；每个 Profile 对应一个独立 node 进程（与 Console 3928 无关）。</p>
  `;
  const procs = data.processes || [];
  document.getElementById('overview-process-hint').textContent = procs.length
    ? `${procs.length} 个进程已注册`
    : '暂无运行中的 Bot 进程';
  document.getElementById('overview-processes').innerHTML = procs.length
    ? table(
        ['PID', 'Profile', 'Bot', 'AppId', 'Agent', '启动时间'],
        procs.map((r) => [
          cell(r.pid),
          cell(r.profileName),
          cell(r.botName ?? '连接中…'),
          cell(r.appId),
          cell(r.agentKind),
          cell(new Date(r.startedAt).toLocaleString()),
        ]),
      )
    : '<p class="hint">没有 Bot 在跑。到 <a href="#fleet">Fleet</a> 点「启动全部」，或 <a href="#bots">Bot 绑定</a> 页逐个启动。</p>';
  const fleet = data.fleetStatus || [];
  document.getElementById('overview-fleet').innerHTML = fleet.length
    ? table(
        ['Profile', 'Agent', 'Daemon', '已连接', 'Bot', 'PID'],
        fleet.map((r) => [
          cell(r.profile),
          cell(r.agentKind),
          badge(r.daemonRunning, '运行', r.daemonRegistered ? '已注册' : '-'),
          badge(r.connected),
          cell(r.botName ?? '-'),
          cell(r.pid ?? '-'),
        ]),
      )
    : '<p class="hint">尚无 Profile。</p>';
  const subtitle = document.querySelector('.subtitle');
  if (subtitle && data.console?.port) {
    subtitle.textContent = `Console · :${data.console.port}`;
  }
  const warnEl = document.getElementById('overview-warnings');
  if (data.duplicateAppWarnings?.length) {
    warnEl.innerHTML = `<div class="warn-box">⚠ ${esc(data.duplicateAppWarnings.join('；'))}</div>`;
  } else {
    warnEl.innerHTML = '';
  }
}

let qrPollTimer = null;
let qrSessionId = null;
let qrObjectUrl = null;

function revokeQrObjectUrl() {
  if (qrObjectUrl) {
    URL.revokeObjectURL(qrObjectUrl);
    qrObjectUrl = null;
  }
}

function onboardToast(result) {
  if (result.started) return 'Bot 已创建、已登记 Fleet 并已启动';
  if (result.fleetRegistered && result.activated) {
    return `Profile 已创建并登记 Fleet${result.startError ? `；${result.startError}` : ''}`;
  }
  return result.startError || 'Bot 绑定完成';
}

async function fillWorkspaceDefault(form, profileName) {
  const name = profileName?.trim();
  const ws = form.querySelector('[name="workspace"]');
  if (!name || !ws || ws.dataset.userEdited === '1') return;
  try {
    const d = await api(`/api/bots/defaults?profile=${encodeURIComponent(name)}`);
    ws.value = d.workspace;
    ws.dataset.autoValue = d.workspace;
    ws.title = d.exists ? '工作区已存在' : '绑定后将自动创建此目录';
  } catch {
    /* ignore */
  }
}

function applyBotTemplate(row, formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  const agent = form.querySelector('[name="agent"]');
  const tenant = form.querySelector('[name="tenant"]');
  if (agent) agent.value = row.agentKind || 'cursor';
  if (tenant) tenant.value = row.tenant || 'feishu';
  const nameInput = form.querySelector('[name="name"]');
  const ws = form.querySelector('[name="workspace"]');
  if (ws) ws.dataset.userEdited = '';
  if (nameInput?.value.trim()) {
    void fillWorkspaceDefault(form, nameInput.value);
  } else if (row.workspace) {
    if (ws) {
      ws.value = row.workspace;
      ws.title = `参考：${row.name} 的工作区；新 Profile 会按 {home}-workspaces/{name}/default 生成`;
    }
  }
  toast(`已套用 ${row.name}${row.botName ? `（${row.botName}）` : ''} 的配置模板`);
}

function renderBotsReference(rows) {
  const el = document.getElementById('bots-reference');
  if (!rows.length) {
    el.innerHTML = '<p class="hint">暂无 Bot 节点。完成首次绑定后将显示在这里。</p>';
    return;
  }
  el.innerHTML = `<div class="ref-grid">${rows.map((r) => `
    <article class="node-card ${r.connected ? 'is-live' : 'is-idle'}">
      <div class="node-head">
        <div class="node-name">
          ${esc(r.name)}${r.active ? '<span class="star" title="当前 Profile">★</span>' : ''}
        </div>
        ${r.botName ? `<span class="badge ok">${esc(r.botName)}</span>` : badge(r.connected, '运行中', '离线')}
      </div>
      <dl>
        <dt>Agent</dt><dd>${esc(r.agentKind)}${r.cursorModel ? ` · ${esc(r.cursorModel)}` : ''}</dd>
        <dt>AppId</dt><dd>${esc(r.appId ?? '—')}</dd>
        <dt>Tenant</dt><dd>${esc(r.tenant ?? 'feishu')}</dd>
        <dt>工作区</dt><dd>${esc(r.workspace ?? '—')} ${r.workspace ? badge(r.workspaceExists, '存在', '待创建') : ''}</dd>
        <dt>lark-cli</dt><dd>${esc(r.larkCliBound ? (r.larkCliIdentity ?? '已绑定') : '未绑定')}</dd>
        <dt>群聊</dt><dd>${esc(String(r.allowedChatsCount ?? 0))} allowedChats</dd>
      </dl>
      <div class="node-actions btn-row">
        <button type="button" class="btn sm btn-apply-qr" data-name="${esc(r.name)}">套用到扫码</button>
        <button type="button" class="btn sm btn-apply-cred" data-name="${esc(r.name)}">套用到凭证</button>
      </div>
    </article>
  `).join('')}</div>`;
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  el.querySelectorAll('.btn-apply-qr').forEach((btn) => {
    btn.onclick = () => applyBotTemplate(byName[btn.dataset.name], 'qr-complete-form');
  });
  el.querySelectorAll('.btn-apply-cred').forEach((btn) => {
    btn.onclick = () => applyBotTemplate(byName[btn.dataset.name], 'bot-cred-form');
  });
}

function bindWorkspaceAutoFill(form) {
  const nameInput = form.querySelector('[name="name"]');
  const ws = form.querySelector('[name="workspace"]');
  if (!nameInput || !ws) return;
  ws.addEventListener('input', () => {
    if (ws.value !== ws.dataset.autoValue) ws.dataset.userEdited = '1';
  });
  nameInput.addEventListener('input', () => {
    void fillWorkspaceDefault(form, nameInput.value);
  });
  nameInput.addEventListener('blur', () => {
    void fillWorkspaceDefault(form, nameInput.value);
  });
}

async function loadBots() {
  const rows = await api('/api/bots');
  renderBotsReference(rows);
  document.getElementById('bots-table').innerHTML = table(
    ['Profile', 'Agent', 'Bot', 'AppId', '工作区', '连接', 'lark-cli', '密钥', '操作'],
    rows.map((r) => [
      cell(r.name + (r.active ? ' ★' : '')),
      cell(r.agentKind + (r.cursorModel ? ` (${r.cursorModel})` : '')),
      cell(r.botName ?? '-'),
      cell(r.appId ?? '—'),
      `<span class="mono">${esc((r.workspace ?? '—').slice(0, 36))}${(r.workspace?.length > 36 ? '…' : '')}${r.workspace && !r.workspaceExists ? ' ⏳' : ''}</span>`,
      badge(r.connected),
      badge(r.larkCliBound, r.larkCliIdentity ?? '已绑定', '未绑定'),
      badge(r.secretStored, '已存', '-'),
      `<div class="btn-row">
        <button class="btn sm btn-bot-use" data-p="${esc(r.name)}">设为当前</button>
        <button class="btn sm primary btn-bot-start" data-p="${esc(r.name)}">启动</button>
        <button class="btn sm btn-bot-stop" data-p="${esc(r.name)}">停止</button>
      </div>`,
    ]),
  );
  document.querySelectorAll('.btn-bot-use').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/bots/${encodeURIComponent(btn.dataset.p)}/use`, { method: 'POST' });
      toast('已设为当前 Profile');
      loadBots();
    };
  });
  document.querySelectorAll('.btn-bot-start').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/bots/${encodeURIComponent(btn.dataset.p)}/start`, { method: 'POST' });
        toast('启动命令已执行（含 lark-cli 绑定）');
        setTimeout(loadBots, 2000);
      } catch (e) {
        toast(e.message);
      }
    };
  });
  document.querySelectorAll('.btn-bot-stop').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/bots/${encodeURIComponent(btn.dataset.p)}/stop`, { method: 'POST' });
      toast('已停止');
      loadBots();
    };
  });
}

async function loadProfiles() {
  const rows = await api('/api/profiles');
  document.getElementById('profiles-table').innerHTML = table(
    ['Profile', 'Agent', 'Active', 'Daemon', 'Connected', 'Bot', 'PID'],
    rows.map((r) => [
      cell(r.name),
      cell(r.agentKind),
      badge(r.active, '当前', ''),
      badge(r.daemonRunning, '运行', r.daemonRegistered ? '已注册' : '-'),
      badge(r.connected),
      cell(r.botName ?? '-'),
      cell(r.pid ?? '-'),
    ]),
  );
}

async function loadFleet() {
  if (document.activeElement?.id === 'fleet-editor') return;
  const { config, status } = await api('/api/fleet');
  document.getElementById('fleet-editor').value = JSON.stringify(config, null, 2);
  const autoStart = new Set(config.autoStart ?? []);
  document.getElementById('fleet-status-table').innerHTML = table(
    ['Profile', 'Agent', 'Daemon', 'Connected', 'Bot', 'PID', 'autoStart', '操作'],
    (status || []).map((r) => [
      cell(r.profile),
      cell(r.agentKind),
      badge(r.daemonRunning, '运行', r.daemonRegistered ? '已注册' : '-'),
      badge(r.connected),
      cell(r.botName ?? '-'),
      cell(r.pid ?? '-'),
      badge(autoStart.has(r.profile), '是', '否'),
      `<span class="row-actions">
        <button class="btn compact fleet-act" data-act="start" data-profile="${esc(r.profile)}" type="button">启动</button>
        <button class="btn compact fleet-act" data-act="stop" data-profile="${esc(r.profile)}" type="button">停止</button>
        <button class="btn compact fleet-act" data-act="restart" data-profile="${esc(r.profile)}" type="button">重启</button>
      </span>`,
    ]),
  );
  document.querySelectorAll('.fleet-act').forEach((btn) => {
    btn.onclick = () => fleetOp(`/api/fleet/${btn.dataset.act}`, { profiles: [btn.dataset.profile] }, btn);
  });
}

async function fleetOp(path, body, btn) {
  const label = btn?.textContent ?? 'Fleet';
  if (btn) {
    btn.disabled = true;
    btn.dataset.busy = '1';
  }
  toast(`${label} 执行中…（Bot 在后台启动，约 30–60s）`);
  try {
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) });
    toast(r.summary || `${label} 完成`);
    await loadFleet();
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      delete btn.dataset.busy;
    }
  }
}

async function loadProcesses() {
  const rows = await api('/api/processes');
  document.getElementById('processes-table').innerHTML = table(
    ['ID', 'PID', 'Profile', 'Bot', 'AppId', '启动', '操作'],
    rows.map((r) => [
      cell(r.id),
      cell(r.pid),
      cell(r.profileName),
      cell(r.botName ?? '-'),
      cell(r.appId),
      cell(new Date(r.startedAt).toLocaleString()),
      `<button class="btn danger btn-kill" data-id="${esc(r.id)}">终止</button>`,
    ]),
  );
  document.querySelectorAll('.btn-kill').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`终止进程 ${btn.dataset.id}？`)) return;
      await api(`/api/processes/${btn.dataset.id}/kill`, { method: 'POST' });
      toast('已终止');
      loadProcesses();
    };
  });
}

async function loadScheduleProfileSelect() {
  const profiles = await api('/api/profiles');
  const sel = document.getElementById('schedule-profile');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  if (cur && profiles.some((p) => p.name === cur)) sel.value = cur;
  else {
    const active = profiles.find((p) => p.active);
    if (active) sel.value = active.name;
  }
}

async function loadSchedules() {
  await loadScheduleProfileSelect();
  const groups = await api('/api/schedules');
  let html = '';
  for (const g of groups) {
    html += `<div class="schedule-group"><h3>${esc(g.profile)}</h3>`;
    if (!g.tasks.length) {
      html += '<p class="hint">无任务</p>';
    } else {
      html += table(
        ['ID', 'Cron', 'Prompt', 'Chat', '启用', '操作'],
        g.tasks.map((t) => [
          cell(t.id),
          cell(t.cron),
          cell(t.prompt.slice(0, 40) + (t.prompt.length > 40 ? '…' : '')),
          cell(t.chatIdRedacted),
          badge(t.enabled),
          `<button class="btn danger btn-del-sched" data-p="${esc(g.profile)}" data-id="${esc(t.id)}">删除</button>`,
        ]),
      );
    }
    html += '</div>';
  }
  document.getElementById('schedules-list').innerHTML = html;
  document.querySelectorAll('.btn-del-sched').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('删除此定时任务？')) return;
      await api(`/api/schedules/${encodeURIComponent(btn.dataset.p)}/${btn.dataset.id}`, { method: 'DELETE' });
      toast('已删除');
      loadSchedules();
    };
  });
}

async function loadLogProfiles() {
  const profiles = await api('/api/profiles');
  const sel = document.getElementById('log-profile');
  const cur = sel.value;
  sel.innerHTML = profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  if (cur) sel.value = cur;
  await loadLogFiles();
}

async function loadLogFiles() {
  const profile = document.getElementById('log-profile').value;
  if (!profile) return;
  const { files } = await api(`/api/logs/${encodeURIComponent(profile)}`);
  const sel = document.getElementById('log-file');
  sel.innerHTML = (files || []).map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  await loadLogContent();
}

async function loadLogContent() {
  const profile = document.getElementById('log-profile').value;
  const file = document.getElementById('log-file').value || '';
  if (!profile || !file) {
    document.getElementById('log-content').textContent = '';
    return;
  }
  const { content } = await api(`/api/logs/${encodeURIComponent(profile)}?file=${encodeURIComponent(file)}&lines=120`);
  document.getElementById('log-content').textContent = content || '(空)';
}

const pageLoaders = {
  overview: loadOverview,
  bots: loadBots,
  profiles: loadProfiles,
  fleet: loadFleet,
  processes: loadProcesses,
  schedules: loadSchedules,
  logs: loadLogProfiles,
};

function navigate(page) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  const loader = pageLoaders[page];
  if (loader) loader().catch((e) => toast(e.message));
}

async function refreshAll() {
  if (pauseRefresh) return;
  try {
    const res = await fetch('/api/health');
    document.getElementById('conn-dot').className = res.ok ? 'dot online' : 'dot offline';
    if (!res.ok) return;
  } catch {
    document.getElementById('conn-dot').className = 'dot offline';
    return;
  }
  const page = location.hash.slice(1) || 'overview';
  navigate(page);
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = el.dataset.page;
  });
});

window.addEventListener('hashchange', () => {
  navigate(location.hash.slice(1) || 'overview');
});

document.getElementById('btn-refresh').onclick = () => refreshAll().then(() => toast('已刷新'));

document.getElementById('fleet-editor').addEventListener('focus', () => { pauseRefresh = true; });
document.getElementById('fleet-editor').addEventListener('blur', () => { pauseRefresh = false; });

document.getElementById('fleet-restart').onclick = (e) =>
  fleetOp('/api/fleet/restart', {}, e.currentTarget);

document.getElementById('fleet-start-autostart').onclick = (e) =>
  fleetOp('/api/fleet/start', {}, e.currentTarget);

document.getElementById('fleet-start-all').onclick = (e) =>
  fleetOp('/api/fleet/start', { all: true }, e.currentTarget);

document.getElementById('fleet-stop-all').onclick = (e) =>
  fleetOp('/api/fleet/stop', { all: true }, e.currentTarget);

document.getElementById('fleet-sync-openids').onclick = async () => {
  await api('/api/fleet/sync-openids', { method: 'POST' });
  toast('openId 已同步');
  loadFleet();
};

document.getElementById('fleet-save').onclick = async () => {
  try {
    const config = JSON.parse(document.getElementById('fleet-editor').value);
    await api('/api/fleet', { method: 'PUT', body: JSON.stringify(config) });
    toast('fleet.json 已保存');
    loadFleet();
  } catch (e) {
    toast(e.message);
  }
};

document.getElementById('schedule-form').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const profile = fd.get('profile');
  await api(`/api/schedules/${encodeURIComponent(profile)}`, {
    method: 'POST',
    body: JSON.stringify({
      cron: fd.get('cron'),
      prompt: fd.get('prompt'),
      chatId: fd.get('chatId'),
      silent: fd.get('silent') === 'on',
    }),
  });
  toast('任务已添加');
  e.target.reset();
  loadSchedules();
};

document.getElementById('log-profile').onchange = loadLogFiles;
document.getElementById('log-file').onchange = loadLogContent;
document.getElementById('log-refresh').onclick = loadLogContent;

document.getElementById('token-submit').onclick = () => {
  const t = document.getElementById('token-input').value.trim();
  if (!t) return;
  localStorage.setItem(TOKEN_KEY, t);
  bootstrap();
};

document.getElementById('btn-qr-start').onclick = async () => {
  try {
    if (qrPollTimer) clearInterval(qrPollTimer);
    revokeQrObjectUrl();
    const { id, status } = await api('/api/bots/register/start', { method: 'POST' });
    qrSessionId = id;
    const completeForm = document.getElementById('qr-complete-form');
    completeForm.classList.add('hidden');
    completeForm.querySelector('[name="workspace"]').dataset.userEdited = '';
    const area = document.getElementById('qr-area');
    area.classList.remove('hidden');
    document.getElementById('qr-status').textContent = status === 'ready' ? '请扫码…' : '正在生成二维码…';
    const qrImg = document.getElementById('qr-img');
    qrImg.classList.add('hidden');
    qrImg.removeAttribute('src');
    const showQr = async (sessionId) => {
      try {
        const res = await fetch(`/api/bots/register/${encodeURIComponent(sessionId)}/qrcode`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) return false;
        revokeQrObjectUrl();
        qrObjectUrl = URL.createObjectURL(await res.blob());
        qrImg.src = qrObjectUrl;
        qrImg.classList.remove('hidden');
        return true;
      } catch {
        qrImg.classList.add('hidden');
        return false;
      }
    };
    qrPollTimer = setInterval(async () => {
      try {
        const s = await api(`/api/bots/register/${encodeURIComponent(id)}`);
        if (s.qrUrl) {
          const link = document.getElementById('qr-link');
          link.href = s.qrUrl;
          link.textContent = s.qrUrl.slice(0, 48) + '…';
          await showQr(id);
        }
        if (s.status === 'ready') document.getElementById('qr-status').textContent = '请用飞书 App 扫码';
        if (s.status === 'done') {
          clearInterval(qrPollTimer);
          qrPollTimer = null;
          document.getElementById('qr-status').textContent = `扫码成功 AppId: ${s.appId}`;
          completeForm.classList.remove('hidden');
          const nameInput = completeForm.querySelector('[name="name"]');
          if (nameInput?.value) void fillWorkspaceDefault(completeForm, nameInput.value);
        }
        if (s.status === 'failed') {
          clearInterval(qrPollTimer);
          qrPollTimer = null;
          document.getElementById('qr-status').textContent = s.error || '注册失败';
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2000);
  } catch (err) {
    toast(err.message || '获取二维码失败');
  }
};

document.getElementById('qr-complete-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!qrSessionId) {
    toast('请先获取二维码并完成扫码');
    return;
  }
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const result = await api(`/api/bots/register/${encodeURIComponent(qrSessionId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        agent: fd.get('agent'),
        workspace: workspacePayload(e.target),
      }),
    });
    toast(onboardToast(result));
    qrSessionId = null;
    revokeQrObjectUrl();
    e.target.reset();
    e.target.querySelector('[name="workspace"]').dataset.userEdited = '';
    document.getElementById('qr-area').classList.add('hidden');
    document.getElementById('qr-complete-form').classList.add('hidden');
    loadBots();
  } catch (err) {
    toast(err.message || '绑定失败');
  } finally {
    if (btn) btn.disabled = false;
  }
};

function workspacePayload(form) {
  const ws = form.querySelector('[name="workspace"]');
  const value = ws?.value?.trim();
  if (!value) return undefined;
  if (ws?.dataset.userEdited !== '1' && value === ws?.dataset.autoValue) return undefined;
  return value;
}

document.getElementById('bot-cred-form').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const result = await api('/api/bots', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        agent: fd.get('agent'),
        appId: fd.get('appId'),
        appSecret: fd.get('appSecret'),
        tenant: fd.get('tenant'),
        workspace: workspacePayload(e.target),
      }),
    });
    toast(onboardToast(result));
    e.target.reset();
    e.target.querySelector('[name="workspace"]').dataset.userEdited = '';
    loadBots();
  } catch (err) {
    toast(err.message || '创建失败');
  } finally {
    if (btn) btn.disabled = false;
  }
};

bindWorkspaceAutoFill(document.getElementById('qr-complete-form'));
bindWorkspaceAutoFill(document.getElementById('bot-cred-form'));

function readTokenFromUrl() {
  try {
    const t = new URLSearchParams(window.location.search).get('token');
    return t?.trim() || '';
  } catch {
    return '';
  }
}

function bootstrap() {
  const urlToken = readTokenFromUrl();
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('token');
      window.history.replaceState(null, '', u.pathname + u.hash);
    } catch { /* ignore */ }
  }

  const injected = window.__bridgeAdminToken;
  if (injected) localStorage.setItem(TOKEN_KEY, injected);

  if (!getToken()) {
    showAuthGate();
    return;
  }
  hideAuthGate();
  navigate(location.hash.slice(1) || 'overview');
}

window.__bridgeConsoleBootstrap = bootstrap;
bootstrap();

setInterval(() => {
  if (getToken()) refreshAll();
}, 15000);
