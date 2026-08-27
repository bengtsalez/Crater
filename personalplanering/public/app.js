(() => {
  'use strict';

  // ---------- Constants ----------

  const DOW_LABELS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];
  const MONTH_LABELS = [
    'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
    'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
  ];
  // Fixed categorical order; colors repeat past 8 simultaneous projects.
  const PROJECT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#a7a932', '#88438e', '#790909', '#341f94'];

  const TL_LABEL_WIDTH = 180;
  const TL_DAY_WIDTH = 36;
  const TL_VISIBLE_DAYS = 31;

  const RESOURCE_CATEGORIES = ['mark', 'fasad', 'te'];
  const CATEGORY_LABELS = { mark: 'Mark', fasad: 'Fasad', te: 'TE' };

  // ---------- State ----------

  const state = {
    resources: [],
    projects: [],
    assignments: [],
    users: [],
    currentUser: null,
    tasks: [],
    tlStart: mondayOf(new Date()),
    tlFilterType: '',
    tlSearchQuery: '',
    tlShowHolidays: false,
    monthCursor: startOfMonth(new Date()),
    monthFilterResourceId: '',
    myTasksProjectFilter: null,
    projectDetailId: null,
    projectDetailLineItems: [],
    projectDetailTasks: [],
    projectsSortColumn: 'project_number',
    projectsSortDirection: 'asc',
    projectsSearchQuery: '',
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

  // ISO-8601 veckonummer (vecka börjar måndag, vecka 1 innehåller första torsdagen).
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
    return 1 + Math.round((d - firstThursday) / (7 * 86400000));
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function isWeekend(date) {
    const d = date.getDay();
    return d === 0 || d === 6;
  }

  // Anonymous Gregorian algorithm.
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function midsummerDay(year) {
    for (let d = 20; d <= 26; d++) {
      const date = new Date(year, 5, d);
      if (date.getDay() === 6) return date;
    }
    return new Date(year, 5, 20);
  }

  function allSaintsDay(year) {
    for (let d = 31; d <= 37; d++) {
      const date = new Date(year, 9, d);
      if (date.getDay() === 6) return date;
    }
    return new Date(year, 9, 31);
  }

  const holidayCache = new Map();

  function swedishHolidaysForYear(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const easter = easterSunday(year);
    const entries = [
      [new Date(year, 0, 1), 'Nyårsdagen'],
      [new Date(year, 0, 6), 'Trettondedag jul'],
      [addDays(easter, -2), 'Långfredagen'],
      [easter, 'Påskdagen'],
      [addDays(easter, 1), 'Annandag påsk'],
      [new Date(year, 4, 1), 'Första maj'],
      [addDays(easter, 39), 'Kristi himmelsfärdsdag'],
      [addDays(easter, 49), 'Pingstdagen'],
      [new Date(year, 5, 6), 'Sveriges nationaldag'],
      [midsummerDay(year), 'Midsommardagen'],
      [allSaintsDay(year), 'Alla helgons dag'],
      [new Date(year, 11, 25), 'Juldagen'],
      [new Date(year, 11, 26), 'Annandag jul'],
    ];
    const map = new Map(entries.map(([d, name]) => [toISO(d), name]));
    holidayCache.set(year, map);
    return map;
  }

  function isHoliday(date) {
    return swedishHolidaysForYear(date.getFullYear()).has(toISO(date));
  }

  function holidayName(date) {
    return swedishHolidaysForYear(date.getFullYear()).get(toISO(date)) || '';
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

  function taskCountLabel(n) {
    return `${n} uppgift${n === 1 ? '' : 'er'}`;
  }

  // Lättviktig, icke-blockerande bekräftelse. alert() används fortfarande för fel.
  function toast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 3000);
  }

  // Projekt valbara i dropdowns: aktiva/planerade, plus ev. redan valt projekt
  // (så en redigerad bokning vars projekt hunnit bli avslutat visar rätt värde).
  function activeProjectsForSelect(currentId) {
    return state.projects.filter((p) => p.status !== 'avslutad' || p.id === currentId);
  }

  // Tidigaste bokade startdatum för ett projekt, annars null.
  function plannedStartFor(projectId) {
    return state.assignments
      .filter((a) => a.project_id === projectId)
      .map((a) => a.start_date)
      .sort()[0] || null;
  }

  // Vilket startdatum som gäller att visa: inplanerat om projektet har bokningar, annars preliminärt.
  function effectiveStart(project) {
    const planned = plannedStartFor(project.id);
    if (planned) return { date: planned, planned: true, preliminary: project.start_date || null };
    return { date: project.start_date || null, planned: false, preliminary: project.start_date || null };
  }

  function myOpenTaskCountForProject(projectId) {
    if (!state.currentUser) return 0;
    return state.tasks.filter((t) => t.project_id === projectId && t.status !== 'avslutad').length;
  }

  function matchesProjectSearch(projectNumber) {
    if (!state.tlSearchQuery) return true;
    return String(projectNumber ?? '').toLowerCase().includes(state.tlSearchQuery.toLowerCase());
  }

  function isProjectPast(project) {
    return Boolean(project && project.end_date && project.end_date < toISO(new Date()));
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return new Promise(() => {}); // stoppa vidare bearbetning tills omdirigeringen sker
    }
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
    const [resources, projects, assignments, users, currentUser, tasks] = await Promise.all([
      api('GET', '/api/resources'),
      api('GET', '/api/projects'),
      api('GET', '/api/assignments'),
      api('GET', '/api/users'),
      api('GET', '/api/me'),
      api('GET', '/api/tasks'),
    ]);
    state.resources = resources;
    state.projects = projects;
    state.assignments = assignments;
    state.users = users;
    state.currentUser = currentUser;
    state.tasks = tasks;
  }

  function renderAll() {
    renderTimeline();
    renderMonth();
    renderProjectsTable();
    renderResourcesTables();
    renderMinSida();
    if (state.projectDetailId) renderProjectDetail();
  }

  async function reloadAndRender() {
    await loadAll();
    renderAll();
  }

  // ---------- Tabs ----------

  function activateTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });
  }

  // ---------- Timeline ----------

  function renderTimelineLegend() {
    const legend = document.getElementById('timeline-legend');
    const assignedIds = new Set(state.assignments.map((a) => a.project_id));
    const planeradIds = new Set(state.projects.filter((p) => p.status === 'planerad').map((p) => p.id));
    const projectIds = new Set([...assignedIds, ...planeradIds]);
    const projects = state.projects
      .filter((p) => projectIds.has(p.id) && p.status !== 'avslutad' && matchesProjectSearch(p.project_number))
      .filter((p) => !isProjectPast(p) || state.tlSearchQuery)
      .sort((a, b) => a.project_number.localeCompare(b.project_number));
    legend.innerHTML = projects.map((p) => {
      const count = p.status === 'planerad' ? myOpenTaskCountForProject(p.id) : 0;
      const badge = count > 0
        ? `<span class="badge planerad task-count-badge" data-project="${p.id}">${taskCountLabel(count)}</span>`
        : '';
      const classes = isProjectPast(p) ? 'legend-item tl-past' : 'legend-item';
      return `
        <div class="${classes}">
          <span class="legend-swatch" style="background:${colorForProject(p.id)}"></span>
          <span>${esc(p.project_number)} – ${esc(p.name)}</span>
          ${badge}
        </div>
      `;
    }).join('');
  }

  function renderTimeline() {
    const calendarDays = Array.from({ length: TL_VISIBLE_DAYS }, (_, i) => addDays(state.tlStart, i));
    const days = state.tlShowHolidays ? calendarDays : calendarDays.filter((d) => !isHoliday(d));
    const today = new Date();
    const rangeStartISO = toISO(calendarDays[0]);
    const rangeEndISO = toISO(calendarDays[calendarDays.length - 1]);

    document.getElementById('tl-range-label').textContent = `${rangeStartISO} – ${rangeEndISO}`;

    renderTimelineLegend();

    const employeeCategoryFilter = RESOURCE_CATEGORIES.includes(state.tlFilterType) ? state.tlFilterType : null;
    const employeesVisible = !state.tlFilterType || state.tlFilterType === 'anstalld' || Boolean(employeeCategoryFilter);
    const employeeCategories = employeeCategoryFilter ? [employeeCategoryFilter] : [...RESOURCE_CATEGORIES, null];
    const employeeGroups = employeeCategories.map((category) => ({
      category,
      label: category ? CATEGORY_LABELS[category] : 'Ej kategoriserad',
      resources: employeesVisible
        ? state.resources.filter((r) => r.type === 'anstalld' && r.category === category)
        : [],
    }));
    const subcontractors = state.tlFilterType && state.tlFilterType !== 'underentreprenor'
      ? []
      : state.resources.filter((r) => r.type === 'underentreprenor');

    const gridCols = `${TL_LABEL_WIDTH}px repeat(${days.length}, ${TL_DAY_WIDTH}px)`;

    function weekHeaderCells() {
      const cells = [];
      let i = 0;
      while (i < days.length) {
        const wk = isoWeek(days[i]);
        let span = 1;
        while (i + span < days.length && isoWeek(days[i + span]) === wk) span++;
        cells.push(`<div class="tl-week-cell" style="grid-column: span ${span}">v.${wk}</div>`);
        i += span;
      }
      return cells.join('');
    }

    function dayHeaderCells() {
      return days.map((d) => {
        const classes = ['tl-day-header'];
        if (isWeekend(d)) classes.push('weekend');
        if (isHoliday(d)) classes.push('holiday');
        if (isSameDay(d, today)) classes.push('today');
        const title = isHoliday(d) ? ` title="${esc(holidayName(d))}"` : '';
        return `<div class="${classes.join(' ')}"${title}>${d.getDate()}<span class="dow">${DOW_LABELS[(d.getDay() + 6) % 7]}</span></div>`;
      }).join('');
    }

    function resourceRow(resource) {
      const cells = days.map((d) => {
        const iso = toISO(d);
        const classes = ['tl-cell'];
        if (isWeekend(d)) classes.push('weekend');
        if (isHoliday(d)) classes.push('holiday');
        if (isSameDay(d, today)) classes.push('today');
        const title = isHoliday(d) ? ` title="${esc(holidayName(d))}"` : '';
        return `<div class="${classes.join(' ')}"${title} data-role="cell" data-resource="${resource.id}" data-date="${iso}"></div>`;
      }).join('');
      return `<div class="tl-row-label">${esc(resource.name)}</div>${cells}`;
    }

    function groupHeader(label, categoryKey) {
      const attr = categoryKey ? ` data-category-marker="${categoryKey}"` : '';
      return `<div class="tl-row-label group-header" style="grid-column: 1 / -1"${attr}>${esc(label)}</div>`;
    }

    let gridHtml = `<div class="tl-week-label"></div>${weekHeaderCells()}`;
    gridHtml += `<div class="tl-row-label"></div>${dayHeaderCells()}`;
    employeeGroups.forEach((group) => {
      if (!group.resources.length) return;
      gridHtml += groupHeader(group.label, group.category || 'none');
      gridHtml += group.resources.map(resourceRow).join('');
    });
    if (subcontractors.length) {
      gridHtml += groupHeader('Underentreprenörer');
      gridHtml += subcontractors.map(resourceRow).join('');
    }

    const flaggedProjects = state.projects
      .filter((p) => p.status !== 'avslutad' && p.start_date && p.start_date >= rangeStartISO && p.start_date <= rangeEndISO
        && matchesProjectSearch(p.project_number));

    const wrap = document.getElementById('timeline-wrap');
    wrap.innerHTML = `
      <div class="timeline-inner">
        <div class="timeline-grid" id="timeline-grid" style="grid-template-columns:${gridCols}">${gridHtml}</div>
        <div class="timeline-overlay" id="timeline-overlay"></div>
      </div>
    `;

    // Start flags land at their category's row level; uncategorized projects land at the very top.
    const gridEl = document.getElementById('timeline-grid');
    const dayHeaderEl = gridEl.querySelector('.tl-day-header');
    const baselineTop = dayHeaderEl ? dayHeaderEl.offsetTop + dayHeaderEl.offsetHeight : 0;
    function categoryMarkerTop(category) {
      if (!category) return baselineTop;
      const headerEl = gridEl.querySelector(`[data-category-marker="${category}"]`);
      return headerEl ? headerEl.offsetTop : baselineTop;
    }

    const markers = flaggedProjects
      .map((p) => {
        const dayIndex = days.findIndex((d) => toISO(d) === p.start_date);
        if (dayIndex === -1) return ''; // start date falls on a hidden day (e.g. a holiday)
        const left = TL_LABEL_WIDTH + dayIndex * TL_DAY_WIDTH;
        const top = categoryMarkerTop(p.category);
        const count = p.status === 'planerad' ? myOpenTaskCountForProject(p.id) : 0;
        const badge = count > 0
          ? `<span class="badge planerad task-count-badge" data-project="${p.id}">${taskCountLabel(count)}</span>`
          : '';
        const pastClass = isProjectPast(p) ? ' tl-past' : '';
        return `
          <div class="tl-start-marker${pastClass}" style="left:${left}px; top:${top}px"></div>
          <div class="tl-start-flag${pastClass}" style="left:${left}px; top:${top}px">${esc(p.project_number)} start${badge}</div>
        `;
      }).join('');

    // Assignment bars: one rectangle spanning start-to-end per assignment, not one box per day.
    const allVisibleResources = [...employeeGroups.flatMap((g) => g.resources), ...subcontractors];
    const bars = allVisibleResources
      .map((resource) => {
        const firstCell = gridEl.querySelector(`[data-role="cell"][data-resource="${resource.id}"]`);
        if (!firstCell) return '';
        const rowTop = firstCell.offsetTop;
        const rowHeight = firstCell.offsetHeight;
        const assignments = state.assignments.filter(
          (a) => a.resource_id === resource.id && a.start_date <= rangeEndISO && a.end_date >= rangeStartISO
            && matchesProjectSearch(a.project_number)
        );
        return assignments.map((a) => {
          const startIdx = days.findIndex((d) => toISO(d) >= a.start_date);
          let endIdx = -1;
          for (let i = days.length - 1; i >= 0; i--) {
            if (toISO(days[i]) <= a.end_date) { endIdx = i; break; }
          }
          if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return '';
          const left = TL_LABEL_WIDTH + startIdx * TL_DAY_WIDTH + 1;
          const width = (endIdx - startIdx + 1) * TL_DAY_WIDTH - 2;
          const project = state.projects.find((p) => p.id === a.project_id);
          const barClasses = isProjectPast(project) ? 'tl-bar tl-past' : 'tl-bar';
          return `<div class="${barClasses}" style="left:${left}px; top:${rowTop + 3}px; width:${width}px; height:${rowHeight - 6}px; background:${colorForProject(a.project_id)}" data-assignment="${a.id}" title="${esc(a.project_number)} – ${esc(a.project_name)}">${esc(a.project_number)} ${esc(a.project_name)}</div>`;
        }).join('');
      }).join('');

    document.getElementById('timeline-overlay').innerHTML = markers + bars;

    document.getElementById('timeline-grid').addEventListener('click', (e) => {
      const cellEl = e.target.closest('[data-role="cell"]');
      if (cellEl) {
        openAssignmentModal({ resourceId: Number(cellEl.dataset.resource), date: cellEl.dataset.date });
      }
    });
    const overlayEl = document.getElementById('timeline-overlay');
    let dragSuppressClick = false;

    overlayEl.addEventListener('click', (e) => {
      if (dragSuppressClick) { dragSuppressClick = false; return; }
      const barEl = e.target.closest('[data-assignment]');
      if (barEl) {
        openAssignmentModal({ id: Number(barEl.dataset.assignment) });
      }
    });

    // Drag & drop: flytta en bokning horisontellt → skifta start- OCH slutdatum lika
    // många kalenderdagar (längden bevaras alltid).
    overlayEl.querySelectorAll('.tl-bar[data-assignment]').forEach((barEl) => {
      barEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const assignmentId = Number(barEl.dataset.assignment);
        const assignment = state.assignments.find((a) => a.id === assignmentId);
        if (!assignment) return;
        const startX = e.clientX;
        let moved = false;
        try { barEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          if (!moved && Math.abs(dx) > 4) moved = true;
          if (moved) barEl.style.transform = `translateX(${dx}px)`;
        };
        const onUp = async (ev) => {
          barEl.removeEventListener('pointermove', onMove);
          barEl.removeEventListener('pointerup', onUp);
          barEl.removeEventListener('pointercancel', onUp);
          barEl.style.transform = '';
          if (!moved) return;
          dragSuppressClick = true;

          const deltaCols = Math.round((ev.clientX - startX) / TL_DAY_WIDTH);
          if (deltaCols === 0) return;

          const foundIdx = days.findIndex((d) => toISO(d) >= assignment.start_date);
          const baseIdx = foundIdx === -1 ? 0 : foundIdx;
          const targetIdx = Math.min(Math.max(baseIdx + deltaCols, 0), days.length - 1);
          let newStart = days[targetIdx];
          // days är redan helgdagsfria som standard; om helgdagar visas, hoppa förbi dem.
          let guard = 0;
          while (isHoliday(newStart) && guard < 14) {
            newStart = addDays(newStart, deltaCols > 0 ? 1 : -1);
            guard++;
          }
          const durationDays = Math.round(
            (fromISO(assignment.end_date) - fromISO(assignment.start_date)) / 86400000
          );
          const newEnd = addDays(newStart, durationDays);

          try {
            await api('PUT', `/api/assignments/${assignmentId}`, {
              start_date: toISO(newStart),
              end_date: toISO(newEnd),
            });
            await reloadAndRender();
            toast('Bokning flyttad');
          } catch (err) {
            alert(err.message);
            await reloadAndRender();
          }
        };
        barEl.addEventListener('pointermove', onMove);
        barEl.addEventListener('pointerup', onUp);
        barEl.addEventListener('pointercancel', onUp);
      });
    });
  }

  function goToMyTasksForProject(projectId) {
    state.myTasksProjectFilter = projectId;
    renderMinSida();
    activateTab('minsida');
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
    document.getElementById('tl-search').addEventListener('input', (e) => {
      state.tlSearchQuery = e.target.value.trim();
      renderTimeline();
    });
    document.getElementById('tl-show-holidays').checked = state.tlShowHolidays;
    document.getElementById('tl-show-holidays').addEventListener('change', (e) => {
      state.tlShowHolidays = e.target.checked;
      renderTimeline();
    });
    document.getElementById('btn-add-assignment').addEventListener('click', () => openAssignmentModal({}));

    document.getElementById('timeline-legend').addEventListener('click', (e) => {
      const badgeEl = e.target.closest('.task-count-badge');
      if (badgeEl) goToMyTasksForProject(Number(badgeEl.dataset.project));
    });
    document.getElementById('timeline-wrap').addEventListener('click', (e) => {
      const badgeEl = e.target.closest('.task-count-badge');
      if (badgeEl) goToMyTasksForProject(Number(badgeEl.dataset.project));
    });
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

  function compareProjects(a, b, field) {
    if (field === 'sum') {
      return (a.sum ?? -Infinity) - (b.sum ?? -Infinity);
    }
    if (field === 'start_date') {
      return String(effectiveStart(a).date ?? '').localeCompare(String(effectiveStart(b).date ?? ''));
    }
    const av = String(a[field] ?? '').toLowerCase();
    const bv = String(b[field] ?? '').toLowerCase();
    return av.localeCompare(bv);
  }

  function sortProjects(list) {
    const sorted = [...list].sort((a, b) => compareProjects(a, b, state.projectsSortColumn));
    return state.projectsSortDirection === 'desc' ? sorted.reverse() : sorted;
  }

  function updateProjectsSortIndicators() {
    document.querySelectorAll('#tab-projects th[data-sort]').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === state.projectsSortColumn) {
        th.classList.add(state.projectsSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function startCellHtml(p) {
    const es = effectiveStart(p);
    if (!es.date) return '<td>–</td>';
    const showPrel = es.preliminary && es.preliminary !== es.date;
    const title = es.planned
      ? 'Inplanerat startdatum (tidigaste bokningen)' + (showPrel ? ` · preliminär: ${es.preliminary}` : '')
      : 'Preliminärt startdatum – projektet är inte inplanerat ännu';
    const mark = es.planned ? '' : ' <span class="hint">(prel.)</span>';
    return `<td title="${esc(title)}">${esc(es.date)}${mark}</td>`;
  }

  function projectRow(p, isDone) {
    const statusCell = isDone
      ? ''
      : `<td><span class="badge ${p.status}">${{ aktiv: 'Aktiv', planerad: 'Planerad', avslutad: 'Avslutad' }[p.status] || p.status}</span></td>`;
    const actions = isDone
      ? `<td><button type="button" class="ghost row-reactivate">Återaktivera</button> <button type="button" class="danger row-delete">Ta bort</button></td>`
      : `<td><button type="button" class="danger row-delete">Ta bort</button></td>`;
    return `
      <tr data-id="${p.id}">
        <td>${esc(p.project_number)}</td>
        <td>${esc(p.name)}</td>
        <td>${esc(p.client) || '–'}</td>
        <td>${CATEGORY_LABELS[p.category] || '–'}</td>
        <td>${esc(p.project_manager_username) || '–'}</td>
        <td>${formatSum(p.sum)}</td>
        ${startCellHtml(p)}
        <td>${esc(p.end_date) || '–'}</td>
        ${statusCell}
        ${actions}
      </tr>
    `;
  }

  function matchesProjectQuery(p) {
    const q = state.projectsSearchQuery;
    if (!q) return true;
    return [p.name, p.client, p.project_number]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  }

  function renderProjectsTable() {
    const visible = state.projects.filter(matchesProjectQuery);
    const activeProjects = sortProjects(visible.filter((p) => p.status !== 'avslutad'));
    const doneProjects = sortProjects(visible.filter((p) => p.status === 'avslutad'));

    document.querySelector('#projects-table tbody').innerHTML = activeProjects.length
      ? activeProjects.map((p) => projectRow(p, false)).join('')
      : '<tr><td colspan="10" class="empty-state">Inga projekt.</td></tr>';

    document.querySelector('#projects-done-table tbody').innerHTML = doneProjects.length
      ? doneProjects.map((p) => projectRow(p, true)).join('')
      : '<tr><td colspan="9" class="empty-state">Inga avslutade projekt.</td></tr>';

    updateProjectsSortIndicators();
  }

  function initProjectsTable() {
    ['#projects-table tbody', '#projects-done-table tbody'].forEach((selector) => {
      document.querySelector(selector).addEventListener('click', async (e) => {
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
        if (e.target.closest('.row-reactivate')) {
          e.stopPropagation();
          try {
            await api('PUT', `/api/projects/${id}`, { status: 'aktiv' });
            await reloadAndRender();
          } catch (err) {
            alert(err.message);
          }
          return;
        }
        openProjectDetail(id);
      });
    });
    document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(null));

    document.getElementById('projects-search').addEventListener('input', (e) => {
      state.projectsSearchQuery = e.target.value.trim().toLowerCase();
      renderProjectsTable();
    });

    document.querySelectorAll('#tab-projects th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (state.projectsSortColumn === field) {
          state.projectsSortDirection = state.projectsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.projectsSortColumn = field;
          state.projectsSortDirection = 'asc';
        }
        renderProjectsTable();
      });
    });
  }

  // ---------- Resources tables ----------

  function renderResourceRows(tbodySelector, resources, { showCategory } = {}) {
    const tbody = document.querySelector(tbodySelector);
    tbody.innerHTML = resources.map((r) => `
      <tr data-id="${r.id}">
        <td>${esc(r.name)}</td>
        ${showCategory ? `<td>${CATEGORY_LABELS[r.category] || '–'}</td>` : ''}
        <td>${esc(r.phone) || '–'}</td>
        <td>${r.active ? 'Ja' : 'Nej'}</td>
        <td><button type="button" class="danger row-delete">Ta bort</button></td>
      </tr>
    `).join('');
  }

  function renderResourcesTables() {
    renderResourceRows('#employees-table tbody', state.resources.filter((r) => r.type === 'anstalld'), { showCategory: true });
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

  function guardedHandler(button, fn) {
    return async (e) => {
      if (button.disabled) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = originalText === 'Ta bort' ? 'Tar bort…' : 'Sparar…';
      try {
        await fn(e);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    };
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

  // Sätts när projektmodalen öppnas från ett annat flöde (t.ex. tidslinjen) som vill
  // få tillbaka det skapade projektet. Nollställs vid varje öppning.
  let projectModalOnCreated = null;

  async function openProjectModal(project, opts = {}) {
    projectModalOnCreated = opts.onCreated || null;
    const form = document.getElementById('form-project');
    form.reset();
    document.getElementById('project-modal-title').textContent = project ? 'Redigera projekt' : 'Nytt projekt';
    const deleteBtn = document.getElementById('project-delete-btn');

    form.project_manager_user_id.innerHTML = '<option value="">Ingen vald</option>' +
      state.users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('');

    if (project) {
      form.id.value = project.id;
      form.project_number.value = project.project_number;
      form.project_number.readOnly = false;
      form.name.value = project.name;
      form.client.value = project.client || '';
      form.category.value = project.category || '';
      form.project_manager_user_id.value = project.project_manager_user_id || '';
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
    const submitBtn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', guardedHandler(submitBtn, async (e) => {
      e.preventDefault();
      const payload = {
        project_number: form.project_number.value.trim(),
        name: form.name.value.trim(),
        client: form.client.value.trim(),
        category: form.category.value || null,
        project_manager_user_id: form.project_manager_user_id.value ? Number(form.project_manager_user_id.value) : null,
        sum: form.sum.value === '' ? '' : Number(form.sum.value),
        start_date: form.start_date.value,
        end_date: form.end_date.value,
        status: form.status.value,
        notes: form.notes.value.trim(),
      };
      const id = form.id.value;
      try {
        let created = null;
        if (id) {
          await api('PUT', `/api/projects/${id}`, payload);
        } else {
          created = await api('POST', '/api/projects', payload);
        }
        closeModal('modal-project');
        await reloadAndRender();
        if (created && projectModalOnCreated) {
          const cb = projectModalOnCreated;
          projectModalOnCreated = null;
          cb(created);
        }
      } catch (err) {
        alert(err.message);
      }
    }));
    const deleteBtn = document.getElementById('project-delete-btn');
    deleteBtn.addEventListener('click', guardedHandler(deleteBtn, async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort projektet?')) return;
      try {
        await api('DELETE', `/api/projects/${id}`);
        closeModal('modal-project');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    }));
  }

  // ---------- Resource modal ----------

  function toggleResourceCategoryField(form) {
    const isEmployee = form.type.value === 'anstalld';
    form.querySelector('.cat-field').hidden = !isEmployee;
    form.category.required = isEmployee;
  }

  function openResourceModal(resource) {
    const form = document.getElementById('form-resource');
    form.reset();
    document.getElementById('resource-modal-title').textContent = resource ? 'Redigera person' : 'Lägg till person';
    const deleteBtn = document.getElementById('resource-delete-btn');
    if (resource) {
      form.id.value = resource.id;
      form.name.value = resource.name;
      form.type.value = resource.type;
      form.category.value = resource.category || 'mark';
      form.phone.value = resource.phone || '';
      form.active.checked = Boolean(resource.active);
      deleteBtn.hidden = false;
    } else {
      form.id.value = '';
      form.active.checked = true;
      deleteBtn.hidden = true;
    }
    toggleResourceCategoryField(form);
    openModal('modal-resource');
  }

  function initResourceModal() {
    const form = document.getElementById('form-resource');
    const submitBtn = form.querySelector('button[type="submit"]');
    form.type.addEventListener('change', () => toggleResourceCategoryField(form));
    form.addEventListener('submit', guardedHandler(submitBtn, async (e) => {
      e.preventDefault();
      const payload = {
        name: form.name.value.trim(),
        type: form.type.value,
        category: form.type.value === 'anstalld' ? form.category.value : null,
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
    }));
    const deleteBtn = document.getElementById('resource-delete-btn');
    deleteBtn.addEventListener('click', guardedHandler(deleteBtn, async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort personen?')) return;
      try {
        await api('DELETE', `/api/resources/${id}`);
        closeModal('modal-resource');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    }));
  }

  // ---------- Assignment modal ----------

  function openAssignmentModal({ id, resourceId, date } = {}) {
    const form = document.getElementById('form-assignment');
    form.reset();

    const deleteBtn = document.getElementById('assignment-delete-btn');
    const assignment = id ? state.assignments.find((a) => a.id === id) : null;

    form.resource_id.innerHTML = state.resources
      .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    form.project_id.innerHTML =
      activeProjectsForSelect(assignment ? assignment.project_id : null)
        .map((p) => `<option value="${p.id}">${esc(p.project_number)} – ${esc(p.name)}</option>`).join('') +
      '<option value="__new__">+ Skapa nytt projekt</option>';

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
    form.project_id.dataset.prev = form.project_id.value;
    openModal('modal-assignment');
  }

  function initAssignmentModal() {
    const form = document.getElementById('form-assignment');
    const submitBtn = form.querySelector('button[type="submit"]');

    // "+ Skapa nytt projekt" öppnar den vanliga projektmodalen och förväljer resultatet.
    form.project_id.addEventListener('change', () => {
      if (form.project_id.value !== '__new__') {
        form.project_id.dataset.prev = form.project_id.value;
        return;
      }
      form.project_id.value = form.project_id.dataset.prev || '';
      openProjectModal(null, {
        onCreated: (project) => {
          const newOpt = new Option(`${project.project_number} – ${project.name}`, String(project.id));
          form.project_id.add(newOpt, form.project_id.querySelector('option[value="__new__"]'));
          form.project_id.value = String(project.id);
          form.project_id.dataset.prev = String(project.id);
          toast(`Projekt ${project.project_number} skapat och valt`);
        },
      });
    });
    form.addEventListener('submit', guardedHandler(submitBtn, async (e) => {
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
    }));
    const deleteBtn = document.getElementById('assignment-delete-btn');
    deleteBtn.addEventListener('click', guardedHandler(deleteBtn, async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort bokningen?')) return;
      try {
        await api('DELETE', `/api/assignments/${id}`);
        closeModal('modal-assignment');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    }));
  }

  // ---------- Task modal ----------

  function openTaskModal(task, defaultProjectId) {
    const form = document.getElementById('form-task');
    form.reset();
    document.getElementById('task-modal-title').textContent = task ? 'Redigera uppgift' : 'Ny uppgift';
    const deleteBtn = document.getElementById('task-delete-btn');

    form.project_id.innerHTML = '<option value="">Inget projekt</option>' +
      activeProjectsForSelect(task ? task.project_id : null)
        .map((p) => `<option value="${p.id}">${esc(p.project_number)} – ${esc(p.name)}</option>`).join('');

    if (task) {
      form.id.value = task.id;
      form.title.value = task.title;
      form.project_id.value = task.project_id || '';
      form.due_date.value = task.due_date || '';
      form.notes.value = task.notes || '';
      form.status.value = task.status;
      deleteBtn.hidden = false;
    } else {
      form.id.value = '';
      form.status.value = 'aktiv';
      if (defaultProjectId) form.project_id.value = defaultProjectId;
      deleteBtn.hidden = true;
    }
    openModal('modal-task');
  }

  function initTaskModal() {
    const form = document.getElementById('form-task');
    const submitBtn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', guardedHandler(submitBtn, async (e) => {
      e.preventDefault();
      const payload = {
        title: form.title.value.trim(),
        project_id: form.project_id.value ? Number(form.project_id.value) : null,
        due_date: form.due_date.value,
        notes: form.notes.value.trim(),
        status: form.status.value,
      };
      const id = form.id.value;
      try {
        if (id) {
          await api('PUT', `/api/tasks/${id}`, payload);
        } else {
          await api('POST', '/api/tasks', payload);
        }
        closeModal('modal-task');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    }));
    const deleteBtn = document.getElementById('task-delete-btn');
    deleteBtn.addEventListener('click', guardedHandler(deleteBtn, async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort uppgiften?')) return;
      try {
        await api('DELETE', `/api/tasks/${id}`);
        closeModal('modal-task');
        await reloadAndRender();
      } catch (err) {
        alert(err.message);
      }
    }));
  }

  // ---------- Project detail ----------

  async function openProjectDetail(projectId) {
    state.projectDetailId = projectId;
    await refreshProjectDetail();
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById('tab-project-detail').classList.add('active');
  }

  function closeProjectDetail() {
    state.projectDetailId = null;
    activateTab('projects');
  }

  async function refreshProjectDetail() {
    if (!state.projectDetailId) return;
    const [lineItems, tasks] = await Promise.all([
      api('GET', `/api/projects/${state.projectDetailId}/line-items`),
      api('GET', `/api/projects/${state.projectDetailId}/tasks`),
    ]);
    state.projectDetailLineItems = lineItems;
    state.projectDetailTasks = tasks;
    renderProjectDetail();
  }

  function renderLineItemsTable(tbodySelector, items) {
    const tbody = document.querySelector(tbodySelector);
    tbody.innerHTML = items.length
      ? items.map((li) => `
          <tr data-id="${li.id}">
            <td>${esc(li.description)}</td>
            <td>${esc(li.date) || '–'}</td>
            <td>${formatSum(li.amount)}</td>
            <td><button type="button" class="danger row-delete">Ta bort</button></td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="empty-state">Inga rader ännu.</td></tr>';
  }

  function renderProjectDetail() {
    const project = state.projects.find((p) => p.id === state.projectDetailId);
    if (!project) {
      closeProjectDetail();
      return;
    }

    document.getElementById('pd-title').textContent = `${project.project_number} – ${project.name}`;
    const statusLabels = { aktiv: 'Aktiv', planerad: 'Planerad', avslutad: 'Avslutad' };
    const badge = document.getElementById('pd-status-badge');
    badge.textContent = statusLabels[project.status] || project.status;
    badge.className = `badge ${project.status}`;
    const es = effectiveStart(project);
    const showPrel = es.preliminary && es.preliminary !== es.date;
    const startSpan = es.planned
      ? `<span>Byggstart (inplanerad): ${esc(es.date)}</span>` +
        (showPrel ? `<span class="pd-meta-muted">Preliminär start: ${esc(es.preliminary)}</span>` : '')
      : `<span>Byggstart (preliminär): ${esc(es.date) || '–'}</span>`;
    document.getElementById('pd-meta').innerHTML = `
      <span>Kund: ${esc(project.client) || '–'}</span>
      <span>Projektledare: ${esc(project.project_manager_username) || '–'}</span>
      ${startSpan}
      <span>Byggslut: ${esc(project.end_date) || '–'}</span>
    `;

    const ata = state.projectDetailLineItems.filter((li) => li.type === 'ata');
    const expenses = state.projectDetailLineItems.filter((li) => li.type === 'utgift');
    const baseSum = project.sum || 0;
    const ataTotal = ata.reduce((s, li) => s + li.amount, 0);
    const expenseTotal = expenses.reduce((s, li) => s + li.amount, 0);
    const revenue = baseSum + ataTotal;
    const result = revenue - expenseTotal;

    document.getElementById('pd-financials').innerHTML = `
      <div class="ms-stat"><div class="ms-stat-value">${formatSum(baseSum)}</div><div class="ms-stat-label">Kontraktssumma</div></div>
      <div class="ms-stat"><div class="ms-stat-value">${formatSum(ataTotal)}</div><div class="ms-stat-label">ÄTA-tillägg</div></div>
      <div class="ms-stat"><div class="ms-stat-value">${formatSum(revenue)}</div><div class="ms-stat-label">Intäkter totalt</div></div>
      <div class="ms-stat"><div class="ms-stat-value">${formatSum(expenseTotal)}</div><div class="ms-stat-label">Utgifter totalt</div></div>
      <div class="ms-stat"><div class="ms-stat-value">${formatSum(result)}</div><div class="ms-stat-label">Resultat</div></div>
    `;

    renderLineItemsTable('#change-orders-table tbody', ata);
    renderLineItemsTable('#expenses-table tbody', expenses);

    const staff = state.assignments.filter((a) => a.project_id === project.id)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    document.querySelector('#pd-staff-table tbody').innerHTML = staff.length
      ? staff.map((a) => `
          <tr>
            <td>${esc(a.resource_name)}</td>
            <td>${a.resource_type === 'anstalld' ? 'Anställd' : 'Underentreprenör'}</td>
            <td>${esc(a.start_date)}</td>
            <td>${esc(a.end_date)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="empty-state">Ingen personal inplanerad ännu.</td></tr>';

    const tasks = state.projectDetailTasks;
    document.getElementById('pd-tasks-list').innerHTML = tasks.length
      ? tasks.map((t) => renderTaskRow(t, { showOwner: true, readOnly: !state.currentUser || t.user_id !== state.currentUser.id })).join('')
      : '<div class="empty-state">Inga uppgifter kopplade till projektet ännu.</div>';
  }

  function initProjectDetailTab() {
    document.getElementById('pd-back').addEventListener('click', closeProjectDetail);
    document.getElementById('pd-edit').addEventListener('click', () => {
      openProjectModal(state.projects.find((p) => p.id === state.projectDetailId));
    });
    document.getElementById('btn-add-change-order').addEventListener('click', () => openLineItemModal('ata', null));
    document.getElementById('btn-add-expense').addEventListener('click', () => openLineItemModal('utgift', null));
    document.getElementById('btn-add-project-task').addEventListener('click', () => openTaskModal(null, state.projectDetailId));

    ['#change-orders-table tbody', '#expenses-table tbody'].forEach((selector) => {
      document.querySelector(selector).addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = Number(tr.dataset.id);
        const item = state.projectDetailLineItems.find((li) => li.id === id);
        if (e.target.closest('.row-delete')) {
          if (!confirm('Ta bort raden?')) return;
          try {
            await api('DELETE', `/api/line-items/${id}`);
            await refreshProjectDetail();
          } catch (err) {
            alert(err.message);
          }
          return;
        }
        openLineItemModal(item.type, item);
      });
    });

    document.getElementById('pd-tasks-list').addEventListener('click', async (e) => {
      const row = e.target.closest('.task-row');
      if (!row) return;
      const id = Number(row.dataset.id);
      const task = state.projectDetailTasks.find((t) => t.id === id);
      if (!task || !state.currentUser || task.user_id !== state.currentUser.id) return;
      if (e.target.closest('.task-delete')) {
        if (!confirm('Ta bort uppgiften?')) return;
        try {
          await api('DELETE', `/api/tasks/${id}`);
          await reloadAndRender();
          await refreshProjectDetail();
        } catch (err) {
          alert(err.message);
        }
        return;
      }
      if (e.target.closest('.task-toggle')) {
        const newStatus = task.status === 'avslutad' ? 'aktiv' : 'avslutad';
        try {
          await api('PUT', `/api/tasks/${id}`, { status: newStatus });
          await reloadAndRender();
          await refreshProjectDetail();
        } catch (err) {
          alert(err.message);
        }
        return;
      }
      if (e.target.closest('.task-edit')) {
        openTaskModal(task);
      }
    });
  }

  // ---------- Line item modal ----------

  function openLineItemModal(type, item) {
    const form = document.getElementById('form-line-item');
    form.reset();
    form.project_id.value = state.projectDetailId;
    form.type.value = type;
    const label = type === 'ata' ? 'ÄTA' : 'utgift';
    document.getElementById('line-item-modal-title').textContent = item ? `Redigera ${label}` : `Ny ${label}`;
    const deleteBtn = document.getElementById('line-item-delete-btn');
    if (item) {
      form.id.value = item.id;
      form.description.value = item.description;
      form.amount.value = item.amount;
      form.date.value = item.date || '';
      form.notes.value = item.notes || '';
      deleteBtn.hidden = false;
    } else {
      form.id.value = '';
      deleteBtn.hidden = true;
    }
    openModal('modal-line-item');
  }

  function initLineItemModal() {
    const form = document.getElementById('form-line-item');
    const submitBtn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', guardedHandler(submitBtn, async (e) => {
      e.preventDefault();
      const payload = {
        project_id: Number(form.project_id.value),
        type: form.type.value,
        description: form.description.value.trim(),
        amount: Number(form.amount.value),
        date: form.date.value,
        notes: form.notes.value.trim(),
      };
      const id = form.id.value;
      try {
        if (id) {
          await api('PUT', `/api/line-items/${id}`, payload);
        } else {
          await api('POST', '/api/line-items', payload);
        }
        closeModal('modal-line-item');
        await refreshProjectDetail();
      } catch (err) {
        alert(err.message);
      }
    }));
    const deleteBtn = document.getElementById('line-item-delete-btn');
    deleteBtn.addEventListener('click', guardedHandler(deleteBtn, async () => {
      const id = form.id.value;
      if (!id || !confirm('Ta bort raden?')) return;
      try {
        await api('DELETE', `/api/line-items/${id}`);
        closeModal('modal-line-item');
        await refreshProjectDetail();
      } catch (err) {
        alert(err.message);
      }
    }));
  }

  // ---------- Min sida ----------

  function renderOverview() {
    const myProjects = state.projects.filter(
      (p) => state.currentUser && p.project_manager_user_id === state.currentUser.id
    );
    const total = myProjects.reduce((sum, p) => sum + (p.sum || 0), 0);
    document.getElementById('ms-project-count').textContent = myProjects.length;
    document.getElementById('ms-project-sum').textContent = formatSum(total);
  }

  function renderTaskRow(t, opts = {}) {
    const projectLabel = t.project_id
      ? `${esc(t.project_number)} – ${esc(t.project_name)}`
      : '<span class="task-no-project">Inget projekt</span>';
    const dueLabel = t.due_date ? esc(t.due_date) : '';
    const toggleLabel = t.status === 'avslutad' ? 'Återöppna' : 'Klarmarkera';
    const actions = opts.readOnly
      ? ''
      : `
        <button type="button" class="ghost task-toggle">${toggleLabel}</button>
        <button type="button" class="ghost task-edit">Redigera</button>
        <button type="button" class="danger task-delete">Ta bort</button>
      `;
    return `
      <div class="task-row" data-id="${t.id}">
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${opts.showOwner ? `<span class="task-owner">${esc(t.username)}</span>` : `<span class="task-project">${projectLabel}</span>`}
            ${dueLabel ? `<span class="task-due">Förfaller: ${dueLabel}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">${actions}</div>
      </div>
    `;
  }

  function renderMinSida() {
    renderOverview();

    const filterToolbar = document.getElementById('ms-filter-toolbar');
    let tasks = state.tasks;
    if (state.myTasksProjectFilter) {
      tasks = tasks.filter((t) => t.project_id === state.myTasksProjectFilter);
      const project = state.projects.find((p) => p.id === state.myTasksProjectFilter);
      document.getElementById('ms-filter-project-name').textContent =
        project ? `${project.project_number} – ${project.name}` : '';
      filterToolbar.hidden = false;
    } else {
      filterToolbar.hidden = true;
    }

    const active = tasks.filter((t) => t.status !== 'avslutad');
    const done = tasks.filter((t) => t.status === 'avslutad');

    document.getElementById('tasks-active-list').innerHTML = active.length
      ? active.map(renderTaskRow).join('')
      : '<div class="empty-state">Inga aktiva uppgifter.</div>';

    document.getElementById('tasks-done-list').innerHTML = done.length
      ? done.map(renderTaskRow).join('')
      : '<div class="empty-state">Inga slutförda uppgifter.</div>';
  }

  function initMinSidaTab() {
    document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal(null));

    document.getElementById('ms-clear-filter').addEventListener('click', () => {
      state.myTasksProjectFilter = null;
      renderMinSida();
    });

    ['#tasks-active-list', '#tasks-done-list'].forEach((selector) => {
      document.querySelector(selector).addEventListener('click', async (e) => {
        const row = e.target.closest('.task-row');
        if (!row) return;
        const id = Number(row.dataset.id);
        const task = state.tasks.find((t) => t.id === id);
        if (e.target.closest('.task-delete')) {
          if (!confirm('Ta bort uppgiften?')) return;
          try {
            await api('DELETE', `/api/tasks/${id}`);
            await reloadAndRender();
          } catch (err) {
            alert(err.message);
          }
          return;
        }
        if (e.target.closest('.task-toggle')) {
          const newStatus = task.status === 'avslutad' ? 'aktiv' : 'avslutad';
          try {
            await api('PUT', `/api/tasks/${id}`, { status: newStatus });
            await reloadAndRender();
          } catch (err) {
            alert(err.message);
          }
          return;
        }
        if (e.target.closest('.task-edit')) {
          openTaskModal(task);
        }
      });
    });
  }

  // ---------- Init ----------

  function initLogout() {
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }

  async function init() {
    initTabs();
    initLogout();
    initTimelineToolbar();
    initMonthToolbar();
    initProjectsTable();
    initResourcesTables();
    initMinSidaTab();
    initProjectDetailTab();
    initModalDismiss();
    initProjectModal();
    initResourceModal();
    initAssignmentModal();
    initTaskModal();
    initLineItemModal();

    try {
      await loadAll();
      renderAll();
    } catch (err) {
      alert('Kunde inte ladda data: ' + err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
