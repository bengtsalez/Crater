(() => {
  'use strict';

  // ---------- Constants ----------

  const DOW_LABELS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];
  const MONTH_LABELS = [
    'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
    'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
  ];
  // Fixed categorical order; colors repeat past 8 simultaneous projects.
  const PROJECT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  const TL_LABEL_WIDTH = 180;
  const TL_DAY_WIDTH = 36;
  const TL_VISIBLE_DAYS = 31;

  // ---------- State ----------

  const state = {
    resources: [],
    projects: [],
    assignments: [],
    tlStart: mondayOf(new Date()),
    tlFilterType: '',
    monthCursor: startOfMonth(new Date()),
    monthFilterResourceId: '',
  };

  // ---------- Date helpers ----------

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromISO(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(d, diff);
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function isWeekend(date) {
    const d = date.getDay();
    return d === 0 || d === 6;
  }

  // ---------- Small utils ----------

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function colorForProject(projectId) {
    const idx = (Number(projectId) - 1) % PROJECT_COLORS.length;
    return PROJECT_COLORS[idx < 0 ? idx + PROJECT_COLORS.length : idx];
  }

  function formatSum(sum) {
    if (sum === null || sum === undefined || sum === '') return '–';
    return new Intl.NumberFormat('sv-SE').format(sum) + ' kr';
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = 'Ett fel uppstod.';
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch (_) { /* ignore parse errors */ }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------- Data loading ----------

  async function loadAll() {
    const [resources, projects, assignments] = await Promise.all([
      api('GET', '/api/resources'),
      api('GET', '/api/projects'),
      api('GET', '/api/assignments'),
    ]);
    state.resources = resources;
    state.projects = projects;
    state.assignments = assignments;
  }

  function renderAll() {
    renderTimeline();
    renderMonth();
    renderProjectsTable();
    renderResourcesTables();
  }

  async function reloadAndRender() {
    await loadAll();
    renderAll();
  }

  // ---------- Tabs ----------

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ---------- Timeline ----------

  function assignmentsForResourceOnDate(resourceId, isoDate) {
    return state.assignments.filter(
      (a) => a.resource_id === resourceId && a.start_date <= isoDate && a.end_date >= isoDate
    );
  }

  function renderTimelineLegend() {
    const legend = document.getElementById('timeline-legend');
    const projectIds = [...new Set(state.assignments.map((a) => a.project_id))];
    const projects = state.projects.filter((p) => projectIds.includes(p.id))
      .sort((a, b) => a.project_number.localeCompare(b.project_number));
    legend.innerHTML = projects.map((p) => `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${colorForProject(p.id)}"></span>
        <span>${esc(p.project_number)} – ${esc(p.name)}</span>
      </div>
    `).join('');
  }

  function renderTimeline() {
    const days = Array.from({ length: TL_VISIBLE_DAYS }, (_, i) => addDays(state.tlStart, i));
    const today = new Date();

    document.getElementById('tl-range-label').textContent =
      `${toISO(days[0])} – ${toISO(days[days.length - 1])}`;

    renderTimelineLegend();

    const employees = state.tlFilterType && state.tlFilterType !== 'anstalld'
      ? []
      : state.resources.filter((r) => r.type === 'anstalld');
    const subcontractors = state.tlFilterType && state.tlFilterType !== 'underentreprenor'
      ? []
      : state.resources.filter((r) => r.type === 'underentreprenor');

    const gridCols = `${TL_LABEL_WIDTH}px repeat(${days.length}, ${TL_DAY_WIDTH}px)`;

    function dayHeaderCells() {
      return days.map((d) => {
        const classes = ['tl-day-header'];
        if (isWeekend(d)) classes.push('weekend');
        if (isSameDay(d, today)) classes.push('today');
        return `<div class="${classes.join(' ')}">${d.getDate()}<span class="dow">${DOW_LABELS[(d.getDay() + 6) % 7]}</span></div>`;
      }).join('');
    }

    function resourceRow(resource) {
      const cells = days.map((d) => {
        const iso = toISO(d);
        const classes = ['tl-cell'];
        if (isWeekend(d)) classes.push('weekend');
        if (isSameDay(d, today)) classes.push('today');
        const matches = assignmentsForResourceOnDate(resource.id, iso);
        const bars = matches.map((a) => {
          const showLabel = a.start_date === iso || iso === toISO(days[0]);
          const label = showLabel ? `${esc(a.project_number)} ${esc(a.project_name)}` : '';
          return `<div class="tl-bar" style="background:${colorForProject(a.project_id)}" data-assignment="${a.id}" title="${esc(a.project_number)} – ${esc(a.project_name)}">${label}</div>`;
        }).join('');
        return `<div class="${classes.join(' ')}" data-role="cell" data-resource="${resource.id}" data-date="${iso}">${bars}</div>`;
      }).join('');
      return `<div class="tl-row-label">${esc(resource.name)}</div>${cells}`;
    }

    function groupHeader(label) {
      return `<div class="tl-row-label group-header" style="grid-column: 1 / -1">${esc(label)}</div>`;
    }

    let gridHtml = `<div class="tl-row-label"></div>${dayHeaderCells()}`;
    if (employees.length) {
      gridHtml += groupHeader('Anställda');
      gridHtml += employees.map(resourceRow).join('');
    }
    if (subcontractors.length) {
      gridHtml += groupHeader('Underentreprenörer');
      gridHtml += subcontractors.map(resourceRow).join('');
    }

    const rangeStartISO = toISO(days[0]);
    const rangeEndISO = toISO(days[days.length - 1]);
    const markers = state.projects
      .filter((p) => p.start_date && p.start_date >= rangeStartISO && p.start_date <= rangeEndISO)
      .map((p) => {
        const dayIndex = days.findIndex((d) => toISO(d) === p.start_date);
        const left = TL_LABEL_WIDTH + dayIndex * TL_DAY_WIDTH;
        return `
          <div class="tl-start-marker" style="left:${left}px"></div>
          <div class="tl-start-flag" style="left:${left}px">${esc(p.project_number)} start</div>
        `;
      }).join('');

    const wrap = document.getElementById('timeline-wrap');
    wrap.innerHTML = `
      <div class="timeline-inner">
        <div class="timeline-grid" id="timeline-grid" style="grid-template-columns:${gridCols}">${gridHtml}</div>
        <div class="timeline-overlay">${markers}</div>
      </div>
    `;

    document.getElementById('timeline-grid').addEventListener('click', (e) => {
      const barEl = e.target.closest('[data-assignment]');
      if (barEl) {
        openAssignmentModal({ id: Number(barEl.dataset.assignment) });
        return;
      }
      const cellEl = e.target.closest('[data-role="cell"]');
      if (cellEl) {
        openAssignmentModal({ resourceId: Number(cellEl.dataset.resource), date: cellEl.dataset.date });
      }
    });
  }

  function initTimelineToolbar() {
    document.getElementById('tl-prev').addEventListener('click', () => {
      state.tlStart = addDays(state.tlStart, -7);
      renderTimeline();
    });
    document.getElementById('tl-next').addEventListener('click', () => {
      state.tlStart = addDays(state.tlStart, 7);
      renderTimeline();
    });
    document.getElementById('tl-today').addEventListener('click', () => {
      state.tlStart = mondayOf(new Date());
      renderTimeline();
    });
    document.getElementById('tl-filter').addEventListener('change', (e) => {
      state.tlFilterType = e.target.value;
      renderTimeline();
    });
    document.getElementById('btn-add-assignment').addEventListener('click', () => openAssignmentModal({}));
  }

  // ---------- Month calendar ----------

  function assignmentsOnDate(isoDate, resourceId) {
    return state.assignments.filter((a) => {
      if (a.start_date > isoDate || a.end_date < isoDate) return false;
      if (resourceId && a.resource_id !== Number(resourceId)) return false;
      return true;
    });
  }

  function renderMonth() {
    const cursor = state.monthCursor;
    document.getElementById('mo-label').textContent = `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`;

    const filterSelect = document.getElementById('mo-filter');
    const prevValue = filterSelect.value || state.monthFilterResourceId;
    filterSelect.innerHTML = '<option value="">Alla</option>' +
      state.resources.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    filterSelect.value = prevValue;
    state.monthFilterResourceId = filterSelect.value;

    const firstOfMonth = cursor;
    const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const gridStart = mondayOf(firstOfMonth);
    const gridEnd = addDays(mondayOf(lastOfMonth), 6);
    const today = new Date();

    const dowHeader = DOW_LABELS.map((l) => `<div class="month-dow">${l}</div>`).join('');

    const dayCells = [];
    for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
      const iso = toISO(d);
      const classes = ['month-day'];
      if (d.getMonth() !== cursor.getMonth()) classes.push('other-month');
      if (isSameDay(d, today)) classes.push('today');
      const dayAssignments = assignmentsOnDate(iso, state.monthFilterResourceId)
        .sort((a, b) => a.project_number.localeCompare(b.project_number));
      const chips = dayAssignments.map((a) => {
        const chipClasses = ['chip'];
        if (a.start_date === iso) chipClasses.push('start');
        return `<span class="${chipClasses.join(' ')}" data-assignment="${a.id}" title="${esc(a.project_number)} – ${esc(a.project_name)} (${esc(a.resource_name)})">${esc(a.project_number)} · ${esc(a.resource_name)}</span>`;
      }).join('');
      dayCells.push(`
        <div class="${classes.join(' ')}" data-role="day" data-date="${iso}">
          <div class="day-num">${d.getDate()}</div>
          ${chips}
        </div>
      `);
    }

    document.getElementById('month-grid').innerHTML = dowHeader + dayCells.join('');
  }

  function initMonthToolbar() {
    document.getElementById('mo-prev').addEventListener('click', () => {
      state.monthCursor = addMonths(state.monthCursor, -1);
      renderMonth();
    });
    document.getElementById('mo-next').addEventListener('click', () => {
      state.monthCursor = addMonths(state.monthCursor, 1);
      renderMonth();
    });
    document.getElementById('mo-today').addEventListener('click', () => {
      state.monthCursor = startOfMonth(new Date());
      renderMonth();
    });
    document.getElementById('mo-filter').addEventListener('change', (e) => {
      state.monthFilterResourceId = e.target.value;
      renderMonth();
    });
    document.getElementById('month-grid').addEventListener('click', (e) => {
      const chipEl = e.target.closest('[data-assignment]');
      if (chipEl) {
        openAssignmentModal({ id: Number(chipEl.dataset.assignment) });
        return;
      }
      const dayEl = e.target.closest('[data-role="day"]');
      if (dayEl) {
        openAssignmentModal({ date: dayEl.dataset.date });
      }
    });
  }

  // ---------- Projects table ----------

  function renderProjectsTable() {
    const tbody = document.querySelector('#projects-table tbody');
    tbody.innerHTML = state.projects.map((p) => `
      <tr data-id="${p.id}">
        <td>${esc(p.project_number)}</td>
        <td>${esc(p.name)}</td>
        <td>${esc(p.client) || '–'}</td>
        <td>${esc(p.project_manager) || '–'}</td>
        <td>${formatSum(p.sum)}</td>
        <td>${esc(p.start_date) || '–'}</td>
        <td>${esc(p.end_date) || '–'}</td>
        <td><span class="badge ${p.status}">${p.status === 'aktiv' ? 'Aktiv' : 'Avslutad'}</span></td>
        <td><button type="button" class="danger row-delete">Ta bort</button></td>
      </tr>
    `).join('');
  }

  function initProjectsTable() {
    const tbody = document.querySelector('#projects-table tbody');
    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (e.target.closest('.row-delete')) {
        e.stopPropagation();
        if (!confirm('Ta bort projektet?')) return;
        try {
          await api('DELETE', `/api/projects/${id}`);
          await reloadAndRender();
        } catch (err) {
          alert(err.message);
        }
        return;
      }
      openProjectModal(state.projects.find((p) => p.id === id));
    });
    document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(null));
  }

  // ---------- Resources tables ----------

  function renderResourceRows(tbodySelector, resources) {
    const tbody = document.querySelector(tbodySelector);
    tbody.innerHTML = resources.map((r) => `
      <tr data-id="${r.id}">
        <td>${esc(r.name)}</td>
        <td>${esc(r.phone) || '–'}</td>
        <td>${r.active ? 'Ja' : 'Nej'}</td>
        <td><button type="button" class="danger row-delete">Ta bort</button></td>
      </tr>
    `).join('');
  }

  function renderResourcesTables() {
    renderResourceRows('#employees-table tbody', state.resources.filter((r) => r.type === 'anstalld'));
    renderResourceRows('#subcontractors-table tbody', state.resources.filter((r) => r.type === 'underentreprenor'));
  }

  function initResourcesTables() {
    ['#employees-table tbody', '#subcontractors-table tbody'].forEach((selector) => {
      document.querySelector(selector).addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = Number(tr.dataset.id);
        if (e.target.closest('.row-delete')) {
          e.stopPropagation();
          if (!confirm('Ta bort personen?')) return;
          try {
            await api('DELETE', `/api/resources/${id}`);
            await reloadAndRender();
          } catch (err) {
            alert(err.message);
          }
          return;
        }
        openResourceModal(state.resources.find((r) => r.id === id));
      });
    });
    document.getElementById('btn-add-resource').addEventListener('click', () => openResourceModal(null));
  }

  // ---------- Modal helpers ----------

  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  function initModalDismiss() {
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
      backdrop.querySelectorAll('[data-close]').forEach((btn) => {
        btn.addEventListener('click', () => backdrop.classList.remove('open'));
      });
    });
  }

  // ---------- Project modal ----------

  async function openProjectModal(project) {
    const form = document.getElementById('form-project');
    form.reset();
    document.getElementById('project-modal-title').textContent = project ? 'Redigera projekt' : 'Nytt projekt';
    const deleteBtn = document.getElementById('project-delete-btn');
    if (project) {
      form.id.value = project.id;
      form.project_number.value = project.project_number;
      form.project_number.readOnly = false;
      form.name.value = project.name;
      form.client.value = project.client || '';
      form.project_manager.value = project.project_manager || '';
      form.sum.value = project.sum ?? '';
      form.start_date.value = project.start_date || '';
      form.end_date.value = project.end_date || '';
      form.status.value = project.status;
      form.notes.value = project.notes || '';
      deleteBtn.hidden = false;
    } else {
      form.id.value = '';
      form.project_number.readOnly = true;
      form.project_number.value = '…';
      deleteBtn.hidden = true;
      try {
        const { next } = await api('GET', '/api/projects/next-number');
        form.project_number.value = next;
      } catch (_) {
        form.project_number.value = '';
      }
    }
    openModal('modal-project');
  }

  function initProjectModal() {
    const form = document.getElementById('form-project');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        project_number: form.project_number.value.trim(),
        name: form.name.value.trim(),
        client: form.client.value.trim(),
        project_manager: form.project_manager.value.trim(),
        sum: form.sum.value === '' ? '' : Number(form.sum.value),
        start_date: form.start_date.value,
        end_date: form.end_date.value,
        status: form.status.value,
        notes: form.notes.value.trim(),
      };
      const id = form.id.value;
      try {
        if (id) {
          await api('PUT', `/api/projects/${id}`, payload);
        } else {
          await api('POST', '/api/projects', payload);
        }
        closeModal('modal-project');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById('project-delete-btn').addEventListener('click', async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort projektet?')) return;
      try {
        await api('DELETE', `/api/projects/${id}`);
        closeModal('modal-project');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---------- Resource modal ----------

  function openResourceModal(resource) {
    const form = document.getElementById('form-resource');
    form.reset();
    document.getElementById('resource-modal-title').textContent = resource ? 'Redigera person' : 'Lägg till person';
    const deleteBtn = document.getElementById('resource-delete-btn');
    if (resource) {
      form.id.value = resource.id;
      form.name.value = resource.name;
      form.type.value = resource.type;
      form.phone.value = resource.phone || '';
      form.active.checked = Boolean(resource.active);
      deleteBtn.hidden = false;
    } else {
      form.id.value = '';
      form.active.checked = true;
      deleteBtn.hidden = true;
    }
    openModal('modal-resource');
  }

  function initResourceModal() {
    const form = document.getElementById('form-resource');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: form.name.value.trim(),
        type: form.type.value,
        phone: form.phone.value.trim(),
        active: form.active.checked,
      };
      const id = form.id.value;
      try {
        if (id) {
          await api('PUT', `/api/resources/${id}`, payload);
        } else {
          await api('POST', '/api/resources', payload);
        }
        closeModal('modal-resource');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById('resource-delete-btn').addEventListener('click', async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort personen?')) return;
      try {
        await api('DELETE', `/api/resources/${id}`);
        closeModal('modal-resource');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---------- Assignment modal ----------

  function openAssignmentModal({ id, resourceId, date } = {}) {
    const form = document.getElementById('form-assignment');
    form.reset();

    form.resource_id.innerHTML = state.resources
      .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    form.project_id.innerHTML = state.projects
      .map((p) => `<option value="${p.id}">${esc(p.project_number)} – ${esc(p.name)}</option>`).join('');

    const deleteBtn = document.getElementById('assignment-delete-btn');
    const assignment = id ? state.assignments.find((a) => a.id === id) : null;

    if (assignment) {
      document.getElementById('assignment-modal-title').textContent = 'Redigera bokning';
      form.id.value = assignment.id;
      form.resource_id.value = assignment.resource_id;
      form.project_id.value = assignment.project_id;
      form.start_date.value = assignment.start_date;
      form.end_date.value = assignment.end_date;
      form.note.value = assignment.note || '';
      deleteBtn.hidden = false;
    } else {
      document.getElementById('assignment-modal-title').textContent = 'Boka personal på projekt';
      form.id.value = '';
      if (resourceId) form.resource_id.value = resourceId;
      if (date) {
        form.start_date.value = date;
        form.end_date.value = date;
      }
      deleteBtn.hidden = true;
    }
    openModal('modal-assignment');
  }

  function initAssignmentModal() {
    const form = document.getElementById('form-assignment');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        resource_id: Number(form.resource_id.value),
        project_id: Number(form.project_id.value),
        start_date: form.start_date.value,
        end_date: form.end_date.value,
        note: form.note.value.trim(),
      };
      const id = form.id.value;
      try {
        if (id) {
          await api('PUT', `/api/assignments/${id}`, payload);
        } else {
          await api('POST', '/api/assignments', payload);
        }
        closeModal('modal-assignment');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
    document.getElementById('assignment-delete-btn').addEventListener('click', async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort bokningen?')) return;
      try {
        await api('DELETE', `/api/assignments/${id}`);
        closeModal('modal-assignment');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---------- Init ----------

  async function init() {
    initTabs();
    initTimelineToolbar();
    initMonthToolbar();
    initProjectsTable();
    initResourcesTables();
    initModalDismiss();
    initProjectModal();
    initResourceModal();
    initAssignmentModal();

    try {
      await loadAll();
      renderAll();
    } catch (err) {
      alert('Kunde inte ladda data: ' + err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
