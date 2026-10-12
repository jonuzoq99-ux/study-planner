const STORAGE_KEY = 'study-planner-v1';
const LAST_SYNC_KEY = 'study-planner-last-sync';
const GRADE_STORAGE_KEY = 'study-planner-grades-v1';
const now = new Date();
let currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
let activeFilter = 'all';
let activeView = 'planner';
let portalAuthenticated = false;

const COURSE_ORDER = [
  { id: 'crypto', title: 'Kriptografiya usullari', aliases: ['kriptografiya', 'cryptography'], labs: 30 },
  { id: 'network', title: 'Tarmoq xavfsizligi', aliases: ['tarmoq xavfsizligi', 'network security'], labs: 30 },
  { id: 'usage', title: 'Foydalanishlarni boshqarish', aliases: ['foydalanishlarni boshqarish', 'usage management'], labs: 30 },
  { id: 'kotlin', title: 'Kotlin dasturlash tili', aliases: ['kotlin'], labs: 15 },
  { id: 'python', title: 'Python tilida dasturlash', aliases: ['python'], labs: 15 }
];

const RATING_CATEGORIES = [
  { id: 'independent1', title: 'Mustaqil ta’lim 1', max: 15, aliases: ['mustaqil ish 1', 'mustaqil talim 1', 'mustaqil ta lim 1'] },
  { id: 'independent2', title: 'Mustaqil ta’lim 2', max: 10, aliases: ['mustaqil ish 2', 'mustaqil talim 2', 'mustaqil ta lim 2'] },
  { id: 'current1', title: 'Joriy nazorat 1', max: 30, aliases: ['joriy nazorat 1'] },
  { id: 'current2', title: 'Joriy nazorat 2', max: 20, aliases: ['joriy nazorat 2'] },
  { id: 'midterm', title: 'Oraliq nazorat', max: 20, aliases: ['oraliq nazorat', 'oraliq'] },
  { id: 'final', title: 'Yakuniy nazorat', max: 30, aliases: ['yakuniy nazorat', 'yakuniy'] }
];

const state = {
  tasks: loadTasks(),
  grades: loadGrades(),
};

const refs = {
  totalTasks: document.getElementById('totalTasks'),
  dueSoonCount: document.getElementById('dueSoonCount'),
  overdueCount: document.getElementById('overdueCount'),
  avgScore: document.getElementById('avgScore'),
  taskList: document.getElementById('taskList'),
  calendarGrid: document.getElementById('calendarGrid'),
  monthLabel: document.getElementById('calendarMonthLabel'),
  prevMonthBtn: document.getElementById('prevMonthBtn'),
  nextMonthBtn: document.getElementById('nextMonthBtn'),
  taskItemTemplate: document.getElementById('taskItemTemplate'),
  syncForm: document.getElementById('syncForm'),
  syncButton: document.getElementById('syncButton'),
  syncStatus: document.getElementById('syncStatus'),
  syncMessage: document.getElementById('syncMessage'),
  plannerView: document.getElementById('plannerView'),
  ratingView: document.getElementById('ratingView'),
  plannerTab: document.getElementById('plannerTab'),
  ratingTab: document.getElementById('ratingTab'),
  courseRatings: document.getElementById('courseRatings'),
  gradeSyncStatus: document.getElementById('gradeSyncStatus'),
};

function loadTasks() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const tasks = JSON.parse(stored);
    return Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    console.warn('Mahalliy vazifalar ma’lumotini o‘qib bo‘lmadi.');
    return [];
  }
}

function sameTask(first, second) {
  const normalize = (value) => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  return normalize(first.title) === normalize(second.title) &&
    normalize(first.course) === normalize(second.course) &&
    first.dueDate.slice(0, 10) === second.dueDate.slice(0, 10);
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function loadGrades() {
  const stored = localStorage.getItem(GRADE_STORAGE_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Reyting ma’lumotlarini o‘qib bo‘lmadi.');
    return {};
  }
}

function saveGrades() {
  localStorage.setItem(GRADE_STORAGE_KEY, JSON.stringify(state.grades));
}

function mergePortalTasks(portalTasks) {
  const oldPortalTasks = state.tasks.filter((task) => task.source === 'portal');
  const syncedTasks = portalTasks.map((task) => {
    const previous = oldPortalTasks.find((item) => sameTask(item, task));
    return {
      ...previous,
      ...task,
      id: previous ? previous.id : task.id,
      source: 'portal',
      priority: previous ? previous.priority : task.priority
    };
  });
  state.tasks = syncedTasks;
  saveTasks();
  render();
}

function normalizeText(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function getCourseConfig(courseName) {
  const normalized = normalizeText(courseName);
  return COURSE_ORDER.find((course) =>
    course.aliases.some((alias) => normalized.includes(normalizeText(alias)))
  );
}

function renderRatingView() {
  if (!portalAuthenticated) {
    refs.courseRatings.innerHTML = '<div class="empty-message">Reytinglarni ko‘rish uchun eStudy loginingiz bilan kiring.</div>';
    return;
  }

  const availableCourses = COURSE_ORDER.filter((course) =>
    state.grades[course.id] || state.tasks.some((task) => getCourseConfig(task.course)?.id === course.id)
  );
  refs.courseRatings.innerHTML = '';

  if (!availableCourses.length) {
    refs.courseRatings.innerHTML = '<div class="empty-message">Reytinglarni ko‘rish uchun universitet portalidan sinxronlang.</div>';
    return;
  }

  availableCourses.forEach((course) => {
    const items = state.grades[course.id]?.items || [];
    const courseTasks = state.tasks.filter((task) => getCourseConfig(task.course)?.id === course.id);
    const allItems = [...items];
    courseTasks.forEach((task) => {
      if (!allItems.some((item) => normalizeText(item.name) === normalizeText(task.title))) {
        allItems.push({
          name: task.title,
          score: task.grade,
          max: task.maxGrade || null,
          percentage: task.grade,
        });
      }
    });

    const card = document.createElement('article');
    card.className = 'course-rating-card';
    const header = document.createElement('div');
    header.className = 'course-rating-header';
    const heading = document.createElement('h3');
    heading.textContent = course.title;
    const totalItem = allItems.find((item) => /jami|course total|kurs yakuni/.test(normalizeText(item.name)));
    const total = document.createElement('span');
    total.className = 'course-total-score';
    total.textContent = totalItem ? formatScore(totalItem) : 'Jami: —';
    header.append(heading, total);
    card.appendChild(header);

    const labItems = allItems
      .map((item) => ({ ...item, labNumber: getLabNumber(item.name) }))
      .filter((item) => item.labNumber && item.labNumber <= course.labs);
    const splitAt = course.labs === 30 ? 14 : 7;
    const labGroup1 = labItems.filter((item) => item.labNumber <= splitAt);
    const labGroup2 = labItems.filter((item) => item.labNumber > splitAt);
    const labCategory1 = allItems.find((item) => isLabCategory(item.name, 15));
    const labCategory2 = allItems.find((item) => isLabCategory(item.name, 10));
    const labSection = document.createElement('section');
    labSection.className = 'rating-labs';
    labSection.append(
      makeLabGroup(`Laboratoriya 1–${splitAt}`, 15, 1, splitAt, labGroup1, labCategory1),
      makeLabGroup(`Laboratoriya ${splitAt + 1}–${course.labs}`, 10, splitAt + 1, course.labs - splitAt, labGroup2, labCategory2)
    );
    card.appendChild(labSection);

    const categoryGrid = document.createElement('div');
    categoryGrid.className = 'rating-category-grid';
    RATING_CATEGORIES.forEach((category) => {
      const item = allItems.find((gradeItem) => matchesRatingCategory(gradeItem.name, category));
      const categoryCard = document.createElement('div');
      categoryCard.className = 'rating-category';
      const categoryName = document.createElement('span');
      categoryName.textContent = category.title;
      const categoryScore = document.createElement('strong');
      categoryScore.textContent = item ? formatCategoryScore(item, category.max) : `— / ${category.max}`;
      categoryCard.append(categoryName, categoryScore);
      categoryGrid.appendChild(categoryCard);
    });
    card.appendChild(categoryGrid);

    const visibleUngrouped = allItems.filter((item) =>
      !getLabNumber(item.name) && !isLabCategory(item.name, 15) && !isLabCategory(item.name, 10) && !RATING_CATEGORIES.some((category) =>
        matchesRatingCategory(item.name, category)
      ) && !/jami|course total|kurs yakuni/.test(normalizeText(item.name))
    );
    if (visibleUngrouped.length) {
      const details = document.createElement('details');
      details.className = 'other-grade-items';
      const summary = document.createElement('summary');
      summary.textContent = 'Boshqa baholar';
      const list = document.createElement('ul');
      visibleUngrouped.forEach((item) => {
        const row = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = item.name;
        const score = document.createElement('strong');
        score.textContent = formatScore(item);
        row.append(name, score);
        list.appendChild(row);
      });
      details.append(summary, list);
      card.appendChild(details);
    }

    refs.courseRatings.appendChild(card);
  });
}

function matchesRatingCategory(itemName, category) {
  const name = normalizeText(itemName);
  if (category.aliases.some((alias) => name.includes(normalizeText(alias)))) return true;
  if (category.id === 'independent1' || category.id === 'independent2') {
    const number = category.id === 'independent1' ? '1' : '2';
    return name.includes('mustaqil') && new RegExp(`(?:^|\\s|№)${number}(?:\\s|$)`).test(name);
  }
  if (category.id === 'current1' || category.id === 'current2') {
    const number = category.id === 'current1' ? '1' : '2';
    return name.includes('joriy nazorat') && new RegExp(`(?:^|\\s)${number}(?:\\s|$)`).test(name);
  }
  return false;
}

function isLabCategory(itemName, points) {
  const name = normalizeText(itemName);
  return !getLabNumber(itemName) && name.includes('laboratoriya') && name.includes(`${points} ball`);
}

function getLabNumber(name) {
  const match = normalizeText(name).match(/(?:laboratoriya|laboratory|lab|amaliy\s*mashg\s*ulot)\s*(?:topshirigi|ishi)?\s*(\d+)|(\d+)\s*(?:laboratoriya|laboratory|lab)/);
  return match ? Number(match[1] || match[2]) : null;
}

function makeLabGroup(title, maxPoints, firstNumber, count, items, categoryItem) {
  const group = document.createElement('section');
  group.className = 'lab-group';
  const heading = document.createElement('div');
  heading.className = 'lab-group-heading';
  const groupTitle = document.createElement('strong');
  groupTitle.textContent = title;
  const groupScore = document.createElement('span');
  const calculated = calculateLabGroupScore(items, count, maxPoints);
  groupScore.textContent = categoryItem
    ? `Portal: ${formatCategoryScore(categoryItem, maxPoints)} ball`
    : calculated === '—'
      ? `— / ${maxPoints} ball`
      : `Baholanganlardan: ${calculated} ball`;
  heading.append(groupTitle, groupScore);
  group.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'lab-score-grid';
  for (let number = firstNumber; number < firstNumber + count; number += 1) {
    const item = items.find((gradeItem) => gradeItem.labNumber === number);
    const cell = document.createElement('div');
    cell.className = 'lab-score-cell';
    const label = document.createElement('span');
    label.textContent = String(number);
    const score = document.createElement('strong');
    score.textContent = item ? formatScore(item) : '—';
    cell.append(label, score);
    grid.appendChild(cell);
  }
  group.appendChild(grid);
  return group;
}

function calculateLabGroupScore(items, count, maxPoints) {
  const graded = items.filter((item) =>
    item.percentage !== null && item.percentage !== undefined && item.percentage !== '' &&
    Number.isFinite(Number(item.percentage))
  );
  if (!graded.length) return '—';
  const averagePercentage = graded.reduce((sum, item) => sum + Number(item.percentage), 0) / graded.length;
  return `${(averagePercentage * maxPoints / 100).toFixed(1)} / ${maxPoints}`;
}

function formatScore(item) {
  if (item.score === null || item.score === undefined || item.score === '') return '—';
  const score = Number(item.score);
  const max = Number(item.max);
  if (Number.isFinite(max) && max > 0) return `${trimNumber(score)} / ${trimNumber(max)}`;
  if (item.percentage !== null && item.percentage !== undefined && item.percentage !== '' && Number.isFinite(Number(item.percentage))) {
    return `${trimNumber(item.percentage)}%`;
  }
  return trimNumber(score);
}

function formatCategoryScore(item, categoryMax) {
  if (item.score !== null && item.score !== undefined && Number.isFinite(Number(item.max)) && Number(item.max) > 0) {
    const normalized = Number(item.score) / Number(item.max) * categoryMax;
    return `${trimNumber(normalized)} / ${categoryMax}`;
  }
  if (item.percentage !== null && item.percentage !== undefined && item.percentage !== '' && Number.isFinite(Number(item.percentage))) {
    return `${trimNumber(Number(item.percentage) * categoryMax / 100)} / ${categoryMax}`;
  }
  return formatScore(item);
}

function trimNumber(number) {
  return Number(number).toLocaleString('uz-UZ', { maximumFractionDigits: 2 });
}

function setActiveView(view) {
  activeView = view;
  refs.plannerView.classList.toggle('hidden', view !== 'planner');
  refs.ratingView.classList.toggle('hidden', view !== 'rating');
  refs.plannerTab.classList.toggle('active', view === 'planner');
  refs.ratingTab.classList.toggle('active', view === 'rating');
  refs.courseRatings.classList.toggle('hidden', false);
  renderRatingView();
}

function getFilteredTasks() {
  const tasks = [...state.tasks];

  return tasks.filter((task) => {
    if (activeFilter === 'all') return true;
    const status = getEffectiveStatus(task);
    if (activeFilter === 'done') return status === 'done';
    if (activeFilter === 'overdue') return status === 'overdue';
    if (activeFilter === 'due-soon') {
      const daysLeft = daysUntil(task.dueDate);
      return status !== 'done' && status !== 'overdue' && daysLeft >= 0 && daysLeft <= 7;
    }
    return true;
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

function getDueDate(task) {
  if (task.dueDate.includes('T')) return new Date(task.dueDate);
  return new Date(`${task.dueDate}T23:59:59`);
}

function getEffectiveStatus(task) {
  if (task.status === 'done') return 'done';
  if (getDueDate(task) < new Date()) return 'overdue';
  return task.status;
}

function daysUntil(dateString) {
  const due = new Date(`${dateString.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function updateStats() {
  const tasks = portalAuthenticated ? state.tasks : [];
  const total = tasks.length;
  const dueSoon = tasks.filter((task) => {
    const status = getEffectiveStatus(task);
    return status !== 'done' && status !== 'overdue' && daysUntil(task.dueDate) <= 7 && daysUntil(task.dueDate) >= 0;
  }).length;
  const overdue = tasks.filter((task) => getEffectiveStatus(task) === 'overdue').length;
  const graded = tasks.filter((task) => task.grade !== null && task.grade !== undefined && task.grade !== '');
  const avg = graded.length ? Math.round(graded.reduce((sum, task) => sum + Number(task.grade), 0) / graded.length) : 0;

  refs.totalTasks.textContent = String(total);
  refs.dueSoonCount.textContent = String(dueSoon);
  refs.overdueCount.textContent = String(overdue);
  refs.avgScore.textContent = graded.length ? `${avg}%` : '—';
}

function updateTaskList() {
  if (!portalAuthenticated) {
    refs.taskList.innerHTML = '';
    return;
  }
  const tasks = getFilteredTasks();
  refs.taskList.innerHTML = '';

  if (!tasks.length) {
    refs.taskList.innerHTML = '<div class="empty-message">Bu bo‘limda vazifa yo‘q.</div>';
    return;
  }

  tasks.forEach((task) => {
    const node = refs.taskItemTemplate.content.cloneNode(true);
    const effectiveStatus = getEffectiveStatus(task);
    const statusClass = effectiveStatus === 'done' || effectiveStatus === 'overdue' ? effectiveStatus : task.priority;

    node.querySelector('.task-name').textContent = task.title;
    node.querySelector('.badge').textContent = {
      done: 'Bajarildi',
      overdue: 'Muddati o‘tgan',
      'in-progress': 'Bajarilmoqda',
      pending: 'Kutilmoqda',
      high: 'Yuqori',
      medium: 'O‘rtacha',
      low: 'Past'
    }[effectiveStatus] || ({
      high: 'Yuqori',
      medium: 'O‘rtacha',
      low: 'Past'
    }[task.priority]);
    node.querySelector('.badge').classList.add(statusClass);
    node.querySelector('.course').textContent = task.course;
    node.querySelector('.date').textContent = formatDate(task.dueDate);
    node.querySelector('.score-pill').textContent = task.grade === null || task.grade === undefined || task.grade === '' ? '—' : `${task.grade}%`;

    refs.taskList.appendChild(node);
  });
}

function formatDate(dateString) {
  const date = new Date(dateString.includes('T') ? dateString : `${dateString}T00:00:00`);
  const formatted = new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return dateString.includes('T')
    ? `${formatted}, ${new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit' }).format(date)}`
    : formatted;
}

function renderCalendar() {
  if (!portalAuthenticated) {
    refs.calendarGrid.innerHTML = '';
    refs.monthLabel.textContent = '';
    return;
  }
  const monthName = new Intl.DateTimeFormat('uz-UZ', { month: 'long', year: 'numeric' }).format(currentMonth);
  refs.monthLabel.textContent = monthName;

  const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const endDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const startWeekday = (startDay.getDay() + 6) % 7;
  const totalDays = endDay.getDate();

  const dayNames = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'];
  refs.calendarGrid.innerHTML = '';

  dayNames.forEach((day) => {
    const header = document.createElement('div');
    header.className = 'day-header';
    header.textContent = day;
    refs.calendarGrid.appendChild(header);
  });

  for (let i = 0; i < (startWeekday + 7) % 7; i++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell muted';
    refs.calendarGrid.appendChild(blank);
  }

  for (let d = 1; d <= totalDays; d++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';

    const date = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayNum = document.createElement('div');
    dayNum.className = 'day-number';
    dayNum.textContent = String(d);
    cell.appendChild(dayNum);

    const tasksForDay = state.tasks.filter((task) => task.dueDate.slice(0, 10) === date && getEffectiveStatus(task) !== 'done');

    tasksForDay.slice(0, 3).forEach((task) => {
      const pill = document.createElement('div');
      pill.className = `day-task ${getEffectiveStatus(task)}`;
      pill.textContent = task.title;
      cell.appendChild(pill);
    });

    if (tasksForDay.length > 3) {
      const more = document.createElement('div');
      more.className = 'day-task';
      more.textContent = `+${tasksForDay.length - 3} more`;
      cell.appendChild(more);
    }

    refs.calendarGrid.appendChild(cell);
  }
}

function render() {
  document.querySelectorAll('.authenticated-only').forEach((element) => {
    element.classList.toggle('hidden', !portalAuthenticated);
  });
  updateStats();
  updateTaskList();
  renderCalendar();
  renderRatingView();
}

refs.plannerTab.addEventListener('click', () => setActiveView('planner'));
refs.ratingTab.addEventListener('click', () => setActiveView('rating'));

refs.syncForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  portalAuthenticated = false;
  render();
  refs.syncMessage.textContent = '';
  refs.syncMessage.className = 'sync-message';
  refs.syncStatus.textContent = 'Sinxronlanmoqda…';
  refs.syncButton.disabled = true;

  const passwordInput = document.getElementById('portalPassword');
  const credentials = {
    username: document.getElementById('portalUsername').value.trim(),
    password: passwordInput.value
  };

  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sinxronlash amalga oshmadi.');
    if (!Array.isArray(result.tasks) || !result.grades || typeof result.grades !== 'object' || Array.isArray(result.grades)) {
      throw new Error('Portal javobidagi vazifa yoki reyting ma’lumotlari noto‘g‘ri.');
    }

    state.grades = result.grades;
    portalAuthenticated = true;
    mergePortalTasks(result.tasks);
    saveGrades();
    const syncedAt = new Date();
    localStorage.setItem(LAST_SYNC_KEY, syncedAt.toISOString());
    const label = `Yangilandi: ${syncedAt.toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' })}`;
    refs.syncStatus.textContent = label;
    refs.gradeSyncStatus.textContent = label;
    refs.syncMessage.textContent = `${result.tasks.length} ta vazifa va reytinglar olindi.`;
    refs.syncMessage.classList.add('success');
    render();
  } catch (error) {
    refs.syncStatus.textContent = 'Yangilanmadi';
    refs.syncMessage.textContent = error.message || 'Portalga ulanib bo‘lmadi.';
    refs.syncMessage.classList.add('error');
  } finally {
    passwordInput.value = '';
    credentials.password = '';
    refs.syncButton.disabled = false;
  }
});

refs.prevMonthBtn.addEventListener('click', () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  renderCalendar();
});

refs.nextMonthBtn.addEventListener('click', () => {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((button) => button.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    render();
  });
});

render();
const lastSync = localStorage.getItem(LAST_SYNC_KEY);
if (lastSync) {
  const label = new Date(lastSync).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
  refs.syncStatus.textContent = `Qayta kirish kerak · oxirgi ma’lumot: ${label}`;
  refs.gradeSyncStatus.textContent = 'Qayta kirish kerak';
}
window.setInterval(render, 60_000);
