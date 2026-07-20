(() => {

  const BASE_URL = 'https://regist.nycu.edu.tw/p_student/grd_stdscorelist.aspx?power=5';
  const DETAIL_BASE_URL = 'https://regist.nycu.edu.tw/p_student/grd_stdscoreedit.aspx?power=5';
  const OFFSET_URL = 'https://regist.nycu.edu.tw/p_student/grd_offsetview.aspx?power=8';

  const state = {
    loading: false,
    data: null,
    debug: [],
    predictions: loadPredictions(),
    offsetCredits: 0,
    offsetCourses: [],
    semesterCache: loadSemesterCache(),
    requiredList: loadCourseList('gmRequiredList'),
    electiveList: loadCourseList('gmElectiveList'),
    requiredTargets: loadRequiredTargets(),
    categoryOverrides: loadCategoryOverrides()
  };

  const DROPPED_COURSE_NAMES = new Set([
    '專題探索(一)',
    '計算機圖學概論',
    '電腦視覺實務與深度學習',
    '基礎程式設計'
  ].map(name => normalizeCourseName(name)));

  function init() {
    const fetchButton = document.getElementById('gm-fetch');
    const logButton = document.getElementById('gm-log');
    const closeButton = document.getElementById('gm-close');
    const debugModal = document.getElementById('gm-debug-modal');
    const modalCloseTargets = Array.from(document.querySelectorAll('[data-modal-close="true"]'));
    const debugCopyButton = document.getElementById('gm-debug-copy');
    const tabButtons = Array.from(document.querySelectorAll('.gm-tab-btn'));
    const tabContents = Array.from(document.querySelectorAll('.gm-tab-content'));
    const requiredInput = document.getElementById('gm-required-input');
    const electiveInput = document.getElementById('gm-elective-input');
    const requiredCount = document.getElementById('gm-required-count');
    const electiveCount = document.getElementById('gm-elective-count');
    const requiredTotal = document.getElementById('gm-required-total');
    const requiredTargetInputs = Array.from(document.querySelectorAll('[data-required-input]'));
    const requiredListEl = document.getElementById('gm-required-list');
    const electiveListEl = document.getElementById('gm-elective-list');
    const detailListEls = Array.from(document.querySelectorAll('[data-detail-list]'));

    if (fetchButton) fetchButton.addEventListener('click', () => {
      if (!state.loading) {
        fetchAllSemesters(true);
      }
    });


    if (logButton) logButton.addEventListener('click', () => {
      if (debugModal) {
        debugModal.classList.add('open');
        debugModal.setAttribute('aria-hidden', 'false');
      }
    });

    if (debugCopyButton) {
      debugCopyButton.addEventListener('click', () => {
        const text = state.debug.join('\n');
        if (!text) return;
        navigator.clipboard.writeText(text).catch(error => {
          console.warn('Grade Management: copy log failed', error);
        });
      });
    }

    if (closeButton) closeButton.addEventListener('click', () => {
      window.close();
    });

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(panel => panel.classList.remove('active'));
        button.classList.add('active');
        const target = button.dataset.tab;
        const panel = document.querySelector(`.gm-tab-content[data-content="${target}"]`);
        if (panel) panel.classList.add('active');
        if (target === 'graduation') {
          refreshGraduationView();
        }
      });
    });

    modalCloseTargets.forEach(button => {
      button.addEventListener('click', () => {
        if (!debugModal) return;
        debugModal.classList.remove('open');
        debugModal.setAttribute('aria-hidden', 'true');
      });
    });

    if (requiredInput) {
      requiredInput.value = serializeCourseList(state.requiredList);
      requiredInput.addEventListener('input', () => {
        const list = parseCsv(requiredInput.value);
        state.requiredList = list;
        saveCourseList('gmRequiredList', list);
        if (requiredCount) requiredCount.textContent = String(list.length);
        updateGraduationStats();
        renderGraduationLists(requiredListEl, electiveListEl, detailListEls);
      });
    }

    if (electiveInput) {
      electiveInput.value = serializeCourseList(state.electiveList);
      electiveInput.addEventListener('input', () => {
        const list = parseCsv(electiveInput.value);
        state.electiveList = list;
        saveCourseList('gmElectiveList', list);
        if (electiveCount) electiveCount.textContent = String(list.length);
        updateGraduationStats();
        renderGraduationLists(requiredListEl, electiveListEl, detailListEls);
      });
    }

    requiredTargetInputs.forEach(input => {
      const key = input.dataset.requiredInput;
      if (key && state.requiredTargets[key] !== undefined) {
        input.value = String(state.requiredTargets[key]);
      }
      input.addEventListener('input', () => {
        const targetKey = input.dataset.requiredInput;
        if (!targetKey) return;
        state.requiredTargets[targetKey] = parseCredits(input.value);
        saveRequiredTargets(state.requiredTargets);
        updateRequiredTotal();
      });
    });

    if (requiredCount) requiredCount.textContent = String(state.requiredList.length);
    if (electiveCount) electiveCount.textContent = String(state.electiveList.length);
    if (requiredTotal) requiredTotal.textContent = formatCredits(sumRequiredTargets(state.requiredTargets));
    renderGraduationLists(requiredListEl, electiveListEl, detailListEls);

    renderDebug();
    fetchAllSemesters(false);
  }

  function setStatus(message, type = 'info') {
    const statusEl = document.getElementById('gm-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.type = type;
    logDebug(`狀態：${message}`);
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const fetchButton = document.getElementById('gm-fetch');
    if (fetchButton) {
      fetchButton.disabled = isLoading;
    }
  }

  function renderData(data) {
    const contentEl = document.getElementById('gm-content');
    if (!contentEl) return;

    if (!data || data.semesters.length === 0) {
      logDebug('渲染：沒有成績資料');
      contentEl.innerHTML = '<div class="gm-placeholder">找不到成績資料</div>';
      return;
    }

    const allCourses = data.semesters.reduce((acc, semester) => acc.concat(semester.courses), []);
    const overallGpa = computeGpaForCourses(allCourses);
    const overallProjection = computeGpaProjection(allCourses, state.predictions);
    const totalCreditsWithOffset = overallGpa.credits + state.offsetCredits;
    const gpaHtml = overallGpa.credits > 0
      ? `
        <div class="gm-gpa">
          <div class="gm-gpa-title">GPA 試算（4.3 制）</div>
          <div class="gm-gpa-grid">
            <div>GPA：<strong>${escapeHtml(formatGpa(overallGpa.gpa))}</strong></div>
            <div>可計入學分：${escapeHtml(formatCredits(overallGpa.credits))}</div>
            <div>排除課程：${escapeHtml(overallGpa.excludedCount)}</div>
            ${state.offsetCredits > 0 ? `<div>抵免學分：${escapeHtml(formatCredits(state.offsetCredits))}</div>` : ''}
            ${state.offsetCredits > 0 ? `<div>總學分(含抵免)：${escapeHtml(formatCredits(totalCreditsWithOffset))}</div>` : ''}
            ${overallProjection.credits > 0
              ? `<div>預測GPA：最低：<span data-gpa-min>${escapeHtml(formatGpa(overallProjection.minGpa))}</span> / 平均：<span data-gpa-avg>${escapeHtml(formatGpa(overallProjection.avgGpa))}</span> / 最高：<span data-gpa-max>${escapeHtml(formatGpa(overallProjection.maxGpa))}</span></div>`
              : ''}
            ${overallProjection.missingCount > 0
              ? `<div>未填預測：<span data-gpa-missing>${escapeHtml(overallProjection.missingCount)}</span></div>`
              : ''}
          </div>
        </div>
      `
      : '';

    const html = data.semesters.map((semester, semesterIndex) => {
      const courseHtml = semester.courses.map(course => {
        const courseKey = buildCourseKey(semester, course);
        const existingGrade = normalizeText(course.grade);
        const prediction = state.predictions[courseKey] || { min: '', max: '' };
        const disabled = false;
        const gradeText = existingGrade || '—';
        const category = getCourseCategory(course, courseKey);

        return `
          <div class="gm-course-card">
            <div class="gm-course-main">
              <div class="gm-course-title">
                <span class="gm-course-index">#${escapeHtml(course.index)}</span>
                <span class="gm-course-name">${escapeHtml(course.name)}</span>
              </div>
              <div class="gm-course-meta">
                <span>學分 ${escapeHtml(course.credits)}</span>
                <span>成績 ${escapeHtml(gradeText)}</span>
              </div>
            </div>
            <div class="gm-course-predict">
              <label>選別 ${renderCategorySelect(courseKey, category)}</label>
              <label>最低 ${renderPredictSelect(prediction.min, courseKey, 'min', disabled)}</label>
              <label>最高 ${renderPredictSelect(prediction.max, courseKey, 'max', disabled)}</label>
            </div>
          </div>
        `;
      }).join('');

      const semesterGpa = computeGpaForCourses(semester.courses);
      const semesterProjection = computeGpaProjection(semester.courses, state.predictions);
      const summaryHtml = semester.summary
        ? `
          <div class="gm-summary">
            <div>修課學分：${escapeHtml(semester.summary.totalCredits)}</div>
            <div>實得學分：${escapeHtml(semester.summary.earnedCredits)}</div>
            <div>平均：${escapeHtml(semester.summary.average)}</div>
            <div>名次：${escapeHtml(semester.summary.rank)}</div>
            <div>班級人數：${escapeHtml(semester.summary.classSize)}</div>
            ${semesterGpa.credits > 0
              ? `<div>GPA(4.3)：${escapeHtml(formatGpa(semesterGpa.gpa))}</div>`
              : ''}
            ${semesterProjection.credits > 0
              ? `<div class="gm-summary-projection" data-semester-index="${semesterIndex}">預測GPA：最低：${escapeHtml(formatGpa(semesterProjection.minGpa))} / 平均：${escapeHtml(formatGpa(semesterProjection.avgGpa))} / 最高：${escapeHtml(formatGpa(semesterProjection.maxGpa))}</div>`
              : ''}
          </div>
        `
        : semesterGpa.credits > 0
          ? `
            <div class="gm-summary">
              <div>GPA(4.3)：${escapeHtml(formatGpa(semesterGpa.gpa))}</div>
              <div>可計入學分：${escapeHtml(formatCredits(semesterGpa.credits))}</div>
              ${semesterProjection.credits > 0
                ? `<div class="gm-summary-projection" data-semester-index="${semesterIndex}">預測GPA：最低：${escapeHtml(formatGpa(semesterProjection.minGpa))} / 平均：${escapeHtml(formatGpa(semesterProjection.avgGpa))} / 最高：${escapeHtml(formatGpa(semesterProjection.maxGpa))}</div>`
                : ''}
            </div>
          `
          : '';

      const semesterId = `gm-semester-${semesterIndex}`;
      return `
        <div class="gm-semester">
          <button class="gm-semester-title gm-semester-toggle" data-target="${escapeHtml(semesterId)}" aria-expanded="true">
            <span>學期 ${escapeHtml(semester.termLabel)}（${semester.courses.length} 門）</span>
            <span class="gm-toggle-icon">▾</span>
          </button>
          <div class="gm-semester-body" id="${escapeHtml(semesterId)}">
            <div class="gm-course-list">
              ${courseHtml}
            </div>
            ${summaryHtml}
          </div>
        </div>
      `;
    }).join('');

    const offsetHtml = renderOffsetCourseSection();
    contentEl.innerHTML = gpaHtml + html + offsetHtml;
    bindPredictionInputs();
    bindCategoryOverrides();
    bindSemesterToggles();
    updatePredictionDisplays();
    updateGraduationStats();
    renderGraduationLists();
    logDebug(`渲染：學期數 ${data.semesters.length}`);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function computeGpaForCourses(courses) {
    let totalCredits = 0;
    let totalPoints = 0;
    let excludedCount = 0;

    courses.forEach(course => {
      const credits = parseCredits(course.credits);
      if (!credits) return;

      if (isWithdrawnCourse(course)) {
        excludedCount += 1;
        return;
      }

      if (isPassGrade(course.grade)) {
        excludedCount += 1;
        return;
      }

      const point = gradeToPoint(course.grade);
      if (point === null) {
        excludedCount += 1;
        return;
      }

      totalCredits += credits;
      totalPoints += point * credits;
    });

    return {
      gpa: totalCredits > 0 ? totalPoints / totalCredits : null,
      credits: totalCredits,
      excludedCount
    };
  }

  function computeGpaProjection(courses, predictions) {
    let totalCredits = 0;
    let totalMinPoints = 0;
    let totalMaxPoints = 0;
    let totalAvgPoints = 0;
    let missingCount = 0;
    let excludedCount = 0;

    courses.forEach(course => {
      const credits = parseCredits(course.credits);
      if (!credits) return;

      if (isWithdrawnCourse(course)) {
        excludedCount += 1;
        return;
      }

      if (isPassGrade(course.grade)) {
        excludedCount += 1;
        return;
      }

      const fixedPoint = gradeToPoint(course.grade);
      if (fixedPoint !== null) {
        totalCredits += credits;
        totalMinPoints += fixedPoint * credits;
        totalMaxPoints += fixedPoint * credits;
        totalAvgPoints += fixedPoint * credits;
        return;
      }

      const key = buildCourseKey(null, course);
      const prediction = predictions[key] || {};
      if (isPassGrade(prediction.min) || isPassGrade(prediction.max)) {
        excludedCount += 1;
        return;
      }
      const minPoint = gradeToPoint(prediction.min);
      const maxPoint = gradeToPoint(prediction.max);

      if (minPoint === null && maxPoint === null) {
        missingCount += 1;
        return;
      }

      const effectiveMin = minPoint !== null ? minPoint : maxPoint;
      const effectiveMax = maxPoint !== null ? maxPoint : minPoint;
      const effectiveAvg = (effectiveMin + effectiveMax) / 2;

      totalCredits += credits;
      totalMinPoints += effectiveMin * credits;
      totalMaxPoints += effectiveMax * credits;
      totalAvgPoints += effectiveAvg * credits;
    });

    return {
      minGpa: totalCredits > 0 ? totalMinPoints / totalCredits : null,
      maxGpa: totalCredits > 0 ? totalMaxPoints / totalCredits : null,
      avgGpa: totalCredits > 0 ? totalAvgPoints / totalCredits : null,
      credits: totalCredits,
      missingCount,
      excludedCount
    };
  }

  function buildCourseKey(semester, course) {
    const term = normalizeText(course.term || (semester && semester.termLabel) || '');
    const code = normalizeText(course.code);
    const name = normalizeText(course.name);
    const index = normalizeText(course.index);
    return `${term}|${code}|${name}|${index}`;
  }

  function bindPredictionInputs() {
    const selects = Array.from(document.querySelectorAll('select[data-predict][data-course]'));
    if (selects.length === 0) return;

    selects.forEach(select => {
      select.addEventListener('change', () => {
        const key = select.dataset.course;
        const type = select.dataset.predict;
        if (!key || !type) return;

        if (!state.predictions[key]) {
          state.predictions[key] = { min: '', max: '' };
        }
        state.predictions[key][type] = select.value.trim();
        savePredictions(state.predictions);

        updatePredictionDisplays();
      }, { once: false });
    });
  }

  function bindSemesterToggles() {
    const toggles = Array.from(document.querySelectorAll('.gm-semester-toggle'));
    if (toggles.length === 0) return;

    toggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        const targetId = toggle.dataset.target;
        if (!targetId) return;
        const body = document.getElementById(targetId);
        if (!body) return;
        const isHidden = body.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!isHidden));
      });
    });
  }

  function updatePredictionDisplays() {
    if (!state.data) return;

    const allCourses = state.data.semesters.reduce((acc, semester) => acc.concat(semester.courses), []);
    const overallProjection = computeGpaProjection(allCourses, state.predictions);
    const overallEl = document.querySelector('.gm-gpa');
    if (overallEl) {
      const missingText = overallProjection.missingCount > 0 ? String(overallProjection.missingCount) : '0';
      const minTarget = overallEl.querySelector('[data-gpa-min]');
      const avgTarget = overallEl.querySelector('[data-gpa-avg]');
      const maxTarget = overallEl.querySelector('[data-gpa-max]');
      const missingTarget = overallEl.querySelector('[data-gpa-missing]');
      if (minTarget) minTarget.textContent = formatGpa(overallProjection.minGpa);
      if (avgTarget) avgTarget.textContent = formatGpa(overallProjection.avgGpa);
      if (maxTarget) maxTarget.textContent = formatGpa(overallProjection.maxGpa);
      if (missingTarget) missingTarget.textContent = missingText;
    }

    state.data.semesters.forEach((semester, index) => {
      const projection = computeGpaProjection(semester.courses, state.predictions);
      const target = document.querySelector(`.gm-summary-projection[data-semester-index="${index}"]`);
      if (!target) return;
      if (projection.credits > 0) {
        target.textContent = `預測GPA：最低：${formatGpa(projection.minGpa)} / 平均：${formatGpa(projection.avgGpa)} / 最高：${formatGpa(projection.maxGpa)}`;
      } else {
        target.textContent = '預測GPA：—';
      }
    });
  }

  function renderOffsetCourseSection() {
    if (!state.offsetCourses || state.offsetCourses.length === 0) {
      if (state.offsetCredits > 0) {
        return `
          <div class="gm-semester gm-offset-section">
            <div class="gm-semester-title">抵修課程</div>
            <div class="gm-course-list">
              <div class="gm-course-card gm-course-offset gm-course-offset-title">
                <div class="gm-course-main">
                  <div class="gm-course-title">
                    <span class="gm-course-index">抵免</span>
                    <span class="gm-course-name">抵修課程（明細未取得）</span>
                  </div>
                  <div class="gm-course-meta">
                    <span>學分 ${escapeHtml(formatCredits(state.offsetCredits))}</span>
                    <span>成績 抵免</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      }
      return '';
    }

    const items = state.offsetCourses.map(course => {
      const name = course.name || '—';
      const credits = formatCredits(course.credits || 0);
      return `
        <div class="gm-course-card gm-course-offset">
          <div class="gm-course-main">
            <div class="gm-course-title">
              <span class="gm-course-index">抵免</span>
              <span class="gm-course-name">${escapeHtml(name)}</span>
            </div>
            <div class="gm-course-meta">
              <span>學分 ${escapeHtml(credits)}</span>
              <span>成績 抵免</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="gm-semester gm-offset-section">
        <div class="gm-semester-title">抵修課程</div>
        <div class="gm-course-list">
          <div class="gm-course-card gm-course-offset gm-course-offset-title">
            <div class="gm-course-main">
              <div class="gm-course-title">
                <span class="gm-course-index">抵免</span>
                <span class="gm-course-name">抵修課程</span>
              </div>
            </div>
          </div>
          ${items}
        </div>
      </div>
    `;
  }

  function updateGraduationStats() {
    if (!state.data) return;
    const stats = computeGraduationStats(
      state.data.semesters,
      state.requiredList,
      state.electiveList,
      state.offsetCredits,
      state.offsetCourses
    );
    const targets = document.querySelectorAll('[data-earned]');
    targets.forEach(target => {
      const key = target.dataset.earned;
      if (!key) return;
      target.textContent = formatCredits(stats[key] || 0);
    });
    const remainingTargets = document.querySelectorAll('[data-remaining]');
    remainingTargets.forEach(target => {
      const key = target.dataset.remaining;
      if (!key) return;
      const earned = stats[key] || 0;
      const required = key === 'total'
        ? sumRequiredTargets(state.requiredTargets)
        : (state.requiredTargets[key] || 0);
      const remaining = Math.max(0, required - earned);
      target.textContent = formatCredits(remaining);
    });
    const requiredTotal = document.getElementById('gm-required-total');
    if (requiredTotal) requiredTotal.textContent = formatCredits(sumRequiredTargets(state.requiredTargets));
  }

  function renderGraduationLists(requiredListEl, electiveListEl, detailListEls) {
    const requiredEl = requiredListEl || document.getElementById('gm-required-list');
    const electiveEl = electiveListEl || document.getElementById('gm-elective-list');
    if (!requiredEl || !electiveEl) return;

    const completedNames = getCompletedCourseNames(state.data);
    requiredEl.innerHTML = renderCourseList(state.requiredList, completedNames, 'required');
    electiveEl.innerHTML = renderCourseList(state.electiveList, completedNames, 'core_elective');

    const detailEls = detailListEls && detailListEls.length > 0
      ? detailListEls
      : Array.from(document.querySelectorAll('[data-detail-list]'));
    renderDetailLists(detailEls);
  }

  function renderCourseList(list, completedNames, listCategory) {
    if (!Array.isArray(list) || list.length === 0) {
      return '<div class="gm-grad-empty">尚未匯入清單</div>';
    }

    return list.map(item => {
      const nameKey = normalizeCourseName(item.name);
      if (listCategory && isOverriddenToOtherCategory(nameKey, listCategory)) {
        return '';
      }
      const isDone = completedNames.has(nameKey);
      return `
        <div class="gm-grad-item ${isDone ? 'done' : 'pending'}">
          <span class="gm-grad-mark">${isDone ? '✔' : '✖'}</span>
          <span class="gm-grad-name">${escapeHtml(item.name)}</span>
          <span class="gm-grad-credits">${escapeHtml(formatCredits(item.credits))}</span>
        </div>
      `;
    }).filter(Boolean).join('');
  }

  function renderDetailLists(detailEls) {
    if (!detailEls || detailEls.length === 0) return;
    const lists = computeGraduationCourseLists(state.data, state.requiredList, state.electiveList);
    detailEls.forEach(el => {
      const key = el.dataset.detailList;
      if (!key) return;
      el.innerHTML = renderCategoryCourseList(lists[key] || []);
    });
  }

  function renderCategoryCourseList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return '<div class="gm-grad-empty">尚無</div>';
    }

    return list.map(item => `
      <div class="gm-grad-item done">
        <span class="gm-grad-mark">•</span>
        <span class="gm-grad-name">${escapeHtml(item.name)}</span>
        <span class="gm-grad-credits">${escapeHtml(formatCredits(item.credits))}</span>
      </div>
    `).join('');
  }

  function isOverriddenToOtherCategory(nameKey, listCategory) {
    if (!nameKey) return false;
    const overrides = state.categoryOverrides || {};
    return Object.entries(overrides).some(([courseKey, category]) => {
      if (!category) return false;
      const parts = courseKey.split('|');
      const courseName = normalizeCourseName(parts[2] || '');
      if (!courseName) return false;
      if (courseName !== nameKey) return false;
      return category !== listCategory;
    });
  }

  function bindCategoryOverrides() {
    const selects = Array.from(document.querySelectorAll('select[data-category][data-course]'));
    if (selects.length === 0) return;

    selects.forEach(select => {
      select.addEventListener('change', () => {
        const key = select.dataset.course;
        if (!key) return;
        const value = select.value;
        if (!value) {
          delete state.categoryOverrides[key];
        } else {
          state.categoryOverrides[key] = value;
        }
        saveCategoryOverrides(state.categoryOverrides);
        refreshGraduationView();
      });
    });
  }

  function getCompletedCourseNames(data) {
    const set = new Set();
    if (!data || !Array.isArray(data.semesters)) return set;

    state.offsetCourses.forEach(course => {
      const key = normalizeCourseName(course.name);
      if (key) set.add(key);
    });

    data.semesters.forEach(semester => {
      semester.courses.forEach(course => {
        if (!course.name) return;
        if (isFailedGrade(course.grade) || isWithdrawnCourse(course)) return;
        const key = normalizeCourseName(course.name);
        if (key) set.add(key);
      });
    });

    return set;
  }

  function sumRequiredTargets(targets) {
    if (!targets) return 0;
    return Object.values(targets).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  function updateRequiredTotal() {
    const requiredTotal = document.getElementById('gm-required-total');
    if (!requiredTotal) return;
    requiredTotal.textContent = formatCredits(sumRequiredTargets(state.requiredTargets));
  }

  function refreshGraduationView() {
    updateGraduationStats();
    renderGraduationLists();
    updateRequiredTotal();
  }

  function renderPredictSelect(value, courseKey, type, disabled) {
    const options = getPredictionOptions();
    const selected = normalizePredictValue(value);
    const optionHtml = options.map(option => {
      const isSelected = option.value === selected;
      return `<option value="${escapeHtml(option.value)}"${isSelected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`;
    }).join('');

    return `
      <select class="gm-select" data-predict="${escapeHtml(type)}" data-course="${escapeHtml(courseKey)}" ${disabled ? 'disabled' : ''}>
        ${optionHtml}
      </select>
    `;
  }

  function renderCategorySelect(courseKey, category) {
    const options = getCategoryOptions();
    const optionHtml = options.map(option => {
      const isSelected = option.value === category;
      return `<option value="${escapeHtml(option.value)}"${isSelected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`;
    }).join('');

    return `
      <select class="gm-select" data-category="true" data-course="${escapeHtml(courseKey)}">
        ${optionHtml}
      </select>
    `;
  }

  function getCategoryOptions() {
    return [
      { value: '', label: '自動' },
      { value: 'required', label: '必修' },
      { value: 'core_elective', label: '核心選修' },
      { value: 'other_elective', label: '其他選修' },
      { value: 'core_basic', label: '核心課程-基本素養' },
      { value: 'core_domain', label: '核心課程-領域課程' },
      { value: 'english', label: '英語' },
      { value: 'foreign', label: '共同-外語' }
    ];
  }

  function getPredictionOptions() {
    return [
      { value: '', label: '—' },
      { value: 'A+', label: 'A+' },
      { value: 'A', label: 'A' },
      { value: 'A-', label: 'A-' },
      { value: 'B+', label: 'B+' },
      { value: 'B', label: 'B' },
      { value: 'B-', label: 'B-' },
      { value: 'C+', label: 'C+' },
      { value: 'C', label: 'C' },
      { value: 'C-', label: 'C-' },
      { value: 'F', label: 'F' },
      { value: 'X', label: 'X' },
      { value: 'PASS', label: '通過' },
      { value: 'NO PASS', label: '未通過' }
    ];
  }

  function loadCourseList(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Grade Management: load course list failed', error);
      return [];
    }
  }

  function saveCourseList(key, list) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (error) {
      console.warn('Grade Management: save course list failed', error);
    }
  }

  function loadCategoryOverrides() {
    try {
      const raw = localStorage.getItem('gmCategoryOverrides');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Grade Management: load category overrides failed', error);
      return {};
    }
  }

  function saveCategoryOverrides(overrides) {
    try {
      localStorage.setItem('gmCategoryOverrides', JSON.stringify(overrides));
    } catch (error) {
      console.warn('Grade Management: save category overrides failed', error);
    }
  }

  function loadRequiredTargets() {
    try {
      const raw = localStorage.getItem('gmRequiredTargets');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Grade Management: load required targets failed', error);
      return {};
    }
  }

  function saveRequiredTargets(targets) {
    try {
      localStorage.setItem('gmRequiredTargets', JSON.stringify(targets));
    } catch (error) {
      console.warn('Grade Management: save required targets failed', error);
    }
  }

  function normalizeCourseName(name) {
    if (!name) return '';
    return normalizeText(name).replace(/[()\s（）]/g, '');
  }

  function computeGraduationStats(semesters, requiredList, electiveList, offsetCredits, offsetCourses) {
    const stats = {
      required: 0,
      core_elective: 0,
      other_elective: 0,
      core_basic: 0,
      core_domain: 0,
      english: 0,
      foreign: 0,
      total: 0
    };

    const requiredMap = new Map(requiredList.map(item => [normalizeCourseName(item.name), item]));
    const electiveMap = new Map(electiveList.map(item => [normalizeCourseName(item.name), item]));
    const usedRequired = new Set();
    const usedElective = new Set();

    semesters.forEach(semester => {
      semester.courses.forEach(course => {
        const credits = parseCredits(course.credits);
        if (!credits) return;

        if (isFailedGrade(course.grade) || isWithdrawnCourse(course)) return;

        const nameKey = normalizeCourseName(course.name);
        const overrideKey = buildCourseKey(semester, course);
        const overrideCategory = state.categoryOverrides[overrideKey] || '';
        if (overrideCategory) {
          applyCategory(stats, overrideCategory, credits, nameKey, usedRequired, usedElective);
          return;
        }

        const dimension = normalizeText(course.dimension);

        if (nameKey && requiredMap.has(nameKey)) {
          if (!usedRequired.has(nameKey)) {
            stats.required += credits;
            stats.total += credits;
            usedRequired.add(nameKey);
          }
          return;
        }

        if (nameKey && electiveMap.has(nameKey)) {
          if (!usedElective.has(nameKey)) {
            stats.core_elective += credits;
            stats.total += credits;
            usedElective.add(nameKey);
          }
          return;
        }

        if (dimension.includes('語言與溝通-英文')) {
          stats.english += credits;
          stats.total += credits;
          return;
        }

        if (dimension.includes('語言與溝通-第二外語')) {
          stats.foreign += credits;
          stats.total += credits;
          return;
        }

        if (dimension.includes('基本素養')) {
          stats.core_basic += credits;
          stats.total += credits;
          return;
        }

        if (dimension.includes('領域課程')) {
          stats.core_domain += credits;
          stats.total += credits;
          return;
        }

        stats.other_elective += credits;
        stats.total += credits;
      });
    });

    let offsetUsedCredits = 0;
    if (Array.isArray(offsetCourses)) {
      offsetCourses.forEach(course => {
        const credits = parseCredits(course.credits);
        if (!credits) return;
        const nameKey = normalizeCourseName(course.name);
        if (nameKey && requiredMap.has(nameKey) && !usedRequired.has(nameKey)) {
          stats.required += credits;
          stats.total += credits;
          usedRequired.add(nameKey);
          offsetUsedCredits += credits;
          return;
        }
        if (nameKey && electiveMap.has(nameKey) && !usedElective.has(nameKey)) {
          stats.core_elective += credits;
          stats.total += credits;
          usedElective.add(nameKey);
          offsetUsedCredits += credits;
          return;
        }
      });
    }

    if (offsetCredits > offsetUsedCredits) {
      stats.total += (offsetCredits - offsetUsedCredits);
    }

    const electiveTarget = parseCredits(state.requiredTargets.core_elective);
    if (electiveTarget > 0 && stats.core_elective > electiveTarget) {
      stats.other_elective += stats.core_elective - electiveTarget;
      stats.core_elective = electiveTarget;
    }

    return stats;
  }

  function computeGraduationCourseLists(data, requiredList, electiveList) {
    const lists = {
      core_basic: [],
      core_domain: [],
      english: [],
      foreign: [],
      other_elective: []
    };

    if (!data || !Array.isArray(data.semesters)) return lists;

    const requiredMap = new Map(requiredList.map(item => [normalizeCourseName(item.name), item]));
    const electiveMap = new Map(electiveList.map(item => [normalizeCourseName(item.name), item]));
    const usedRequired = new Set();
    const usedElective = new Set();

    data.semesters.forEach(semester => {
      semester.courses.forEach(course => {
        const credits = parseCredits(course.credits);
        if (!credits) return;
        if (isFailedGrade(course.grade) || isWithdrawnCourse(course)) return;

        const nameKey = normalizeCourseName(course.name);
        const overrideKey = buildCourseKey(semester, course);
        const overrideCategory = state.categoryOverrides[overrideKey] || '';
        if (overrideCategory) {
          pushCourseToList(lists, overrideCategory, course.name, credits);
          return;
        }

        if (nameKey && requiredMap.has(nameKey)) {
          if (!usedRequired.has(nameKey)) {
            usedRequired.add(nameKey);
          }
          return;
        }

        if (nameKey && electiveMap.has(nameKey)) {
          if (!usedElective.has(nameKey)) {
            usedElective.add(nameKey);
          }
          return;
        }

        const dimension = normalizeText(course.dimension);

        if (dimension.includes('語言與溝通-英文')) {
          lists.english.push({ name: course.name, credits });
          return;
        }

        if (dimension.includes('語言與溝通-第二外語')) {
          lists.foreign.push({ name: course.name, credits });
          return;
        }

        if (dimension.includes('基本素養')) {
          lists.core_basic.push({ name: course.name, credits });
          return;
        }

        if (dimension.includes('領域課程')) {
          lists.core_domain.push({ name: course.name, credits });
          return;
        }

        lists.other_elective.push({ name: course.name, credits });
      });
    });

    if (Array.isArray(state.offsetCourses)) {
      const requiredMap = new Map(requiredList.map(item => [normalizeCourseName(item.name), item]));
      const electiveMap = new Map(electiveList.map(item => [normalizeCourseName(item.name), item]));
      const seen = new Set(lists.other_elective.map(item => normalizeCourseName(item.name)));
      state.offsetCourses.forEach(course => {
        const credits = parseCredits(course.credits);
        if (!credits) return;
        const nameKey = normalizeCourseName(course.name);
        if (!nameKey) return;
        if (requiredMap.has(nameKey) || electiveMap.has(nameKey)) return;
        if (seen.has(nameKey)) return;
        lists.other_elective.push({ name: course.name, credits });
        seen.add(nameKey);
      });
    }

    return lists;
  }

  function applyCategory(stats, category, credits, nameKey, usedRequired, usedElective) {
    if (category === 'service') category = 'other_elective';
    if (category === 'required') {
      if (!nameKey || usedRequired.has(nameKey)) return;
      stats.required += credits;
      stats.total += credits;
      usedRequired.add(nameKey);
      return;
    }
    if (category === 'core_elective') {
      if (!nameKey || usedElective.has(nameKey)) return;
      stats.core_elective += credits;
      stats.total += credits;
      usedElective.add(nameKey);
      return;
    }
    if (category === 'core_basic') {
      stats.core_basic += credits;
      stats.total += credits;
      return;
    }
    if (category === 'core_domain') {
      stats.core_domain += credits;
      stats.total += credits;
      return;
    }
    if (category === 'english') {
      stats.english += credits;
      stats.total += credits;
      return;
    }
    if (category === 'foreign') {
      stats.foreign += credits;
      stats.total += credits;
      return;
    }
    if (category === 'other_elective') {
      stats.other_elective += credits;
      stats.total += credits;
    }
  }

  function getCourseCategory(course, courseKey) {
    const override = state.categoryOverrides[courseKey] || '';
    if (override) return override;

    const nameKey = normalizeCourseName(course.name);
    const requiredMap = new Map(state.requiredList.map(item => [normalizeCourseName(item.name), item]));
    const electiveMap = new Map(state.electiveList.map(item => [normalizeCourseName(item.name), item]));

    if (nameKey && requiredMap.has(nameKey)) return 'required';
    if (nameKey && electiveMap.has(nameKey)) return 'core_elective';

    const dimension = normalizeText(course.dimension);
    if (dimension.includes('語言與溝通-英文')) return 'english';
    if (dimension.includes('語言與溝通-第二外語')) return 'foreign';
    if (dimension.includes('基本素養')) return 'core_basic';
    if (dimension.includes('領域課程')) return 'core_domain';
    return 'other_elective';
  }

  function pushCourseToList(lists, category, name, credits) {
    if (category === 'service') category = 'other_elective';
    const entry = { name, credits };
    if (category === 'core_basic') lists.core_basic.push(entry);
    else if (category === 'core_domain') lists.core_domain.push(entry);
    else if (category === 'english') lists.english.push(entry);
    else if (category === 'foreign') lists.foreign.push(entry);
    else if (category === 'other_elective') lists.other_elective.push(entry);
  }

  function isFailedGrade(value) {
    if (!value) return false;
    const normalized = normalizePredictValue(normalizeText(String(value))).toUpperCase();
    return normalized === 'NO PASS' || normalized === 'F' || normalized === 'X' || normalized === 'W' || normalized === 'WITHDRAW';
  }

  function isWithdrawnCourse(course) {
    if (!course) return false;
    const grade = normalizeText(course.grade);
    const status = normalizeText(course.status);
    if (grade.includes('停修') || status.includes('停修')) return true;
    const nameKey = normalizeCourseName(course.name);
    return Boolean(nameKey) && DROPPED_COURSE_NAMES.has(nameKey);
  }

  function parseCsv(content) {
    if (!content) return [];
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const result = [];
    const headerLine = lines[0];
    const startIndex = headerLine.includes('課名') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i += 1) {
      const [name, creditText] = lines[i].split(',').map(text => text.trim());
      if (!name) continue;
      result.push({
        name,
        credits: parseCredits(creditText)
      });
    }

    return result;
  }

  function serializeCourseList(list) {
    if (!Array.isArray(list) || list.length === 0) return '';
    return list.map(item => `${item.name},${formatCredits(item.credits)}`).join('\n');
  }

  function loadSemesterCache() {
    try {
      const raw = localStorage.getItem('gmSemesterCache');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Grade Management: load semester cache failed', error);
      return {};
    }
  }

  function saveSemesterCache(cache) {
    try {
      localStorage.setItem('gmSemesterCache', JSON.stringify(cache));
    } catch (error) {
      console.warn('Grade Management: save semester cache failed', error);
    }
  }

  function loadPredictions() {
    try {
      const raw = localStorage.getItem('gmPredictions');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.warn('Grade Management: load predictions failed', error);
      return {};
    }
  }

  function savePredictions(predictions) {
    try {
      localStorage.setItem('gmPredictions', JSON.stringify(predictions));
    } catch (error) {
      console.warn('Grade Management: save predictions failed', error);
    }
  }


  function parseCredits(value) {
    if (!value) return 0;
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function gradeToPoint(value) {
    if (!value) return null;
    const text = normalizePredictValue(normalizeText(String(value))).toUpperCase();
    if (!text) return null;

    const excludedTokens = ['抵免', '免修', 'W', 'WITHDRAW'];
    if (excludedTokens.some(token => text.includes(token))) return null;

    const gradeMap = {
      'A+': 4.3,
      'A': 4.0,
      'A-': 3.7,
      'B+': 3.3,
      'B': 3.0,
      'B-': 2.7,
      'C+': 2.3,
      'C': 2.0,
      'C-': 1.7,
      'F': 0,
      'X': 0,
      'PASS': 0,
      'NO PASS': 0
    };

    if (gradeMap[text] !== undefined) {
      return gradeMap[text];
    }

    const letterMatch = text.match(/[A-F][+-]?/);
    if (letterMatch && gradeMap[letterMatch[0]] !== undefined) {
      return gradeMap[letterMatch[0]];
    }

    const numericMatch = text.match(/\d+(\.\d+)?/);
    if (numericMatch) {
      const score = Number.parseFloat(numericMatch[0]);
      return Number.isFinite(score) ? numericToPoint(score) : null;
    }

    return null;
  }

  function isPassGrade(value) {
    if (!value) return false;
    const normalized = normalizePredictValue(normalizeText(String(value))).toUpperCase();
    return normalized === 'PASS' || normalized === 'NO PASS';
  }

  function normalizePredictValue(value) {
    if (!value) return '';
    if (value === '通過') return 'PASS';
    if (value === '未通過') return 'NO PASS';
    return value;
  }

  function numericToPoint(score) {
    if (score >= 90) return 4.3;
    if (score >= 85) return 4.0;
    if (score >= 80) return 3.7;
    if (score >= 77) return 3.3;
    if (score >= 73) return 3.0;
    if (score >= 70) return 2.7;
    if (score >= 67) return 2.3;
    if (score >= 63) return 2.0;
    if (score >= 60) return 1.7;
    if (score >= 50) return 1.0;
    return 0;
  }

  function formatGpa(value) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(2);
  }

  function formatCredits(value) {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  async function fetchAllSemesters(forceRefresh) {
    setLoading(true);
    clearDebug();
    setStatus('讀取列表中...');

    try {
      await fetchOffsetCredits();
      const listHtml = await fetchText(BASE_URL);
      logDebug(`列表頁長度：${listHtml.length}`);
      const listDoc = parseHtml(listHtml);

      const formFields = collectFormFields(listDoc);
      if (!formFields.__VIEWSTATE) {
        setStatus('需要登入或無法取得表單資料', 'error');
        setLoading(false);
        return;
      }
      logDebug(`表單欄位：${Object.keys(formFields).length}`);

      const viewActions = collectViewActions(listDoc);
      if (viewActions.length === 0) {
        setStatus('找不到學期列表', 'error');
        setLoading(false);
        return;
      }
      logDebug(`學期按鈕：${viewActions.length}`);
      if (viewActions.length > 0) {
        logDebug(`按鈕清單：${viewActions.slice(0, 10).map(describeAction).join(', ')}`);
      }

      const semesters = [];
      const latestTerm = viewActions.find(action => action.termLabel)?.termLabel || '';
      for (let i = 0; i < viewActions.length; i += 1) {
        const action = viewActions[i];
        const termLabel = action.termLabel || '';
        const useCache = !forceRefresh && termLabel && termLabel !== latestTerm && state.semesterCache[termLabel];
        setStatus(`抓取學期 ${i + 1}/${viewActions.length}...`);

        if (useCache) {
          logDebug(`使用快取：${termLabel}`);
          semesters.push(state.semesterCache[termLabel]);
          continue;
        }

        logDebug(`觸發方式：${describeAction(action)}`);
        const detailHtml = await fetchDetail(formFields, action);
        logDebug(`明細頁長度(${i + 1})：${detailHtml.length}`);
        const detail = parseSemesterDetail(detailHtml);

        if (detail) {
          semesters.push(detail);
          logDebug(`學期 ${i + 1} 課程數：${detail.courses.length}`);
          if (detail.termLabel) {
            state.semesterCache[detail.termLabel] = detail;
          }
        } else {
          logDebug(`學期 ${i + 1} 沒有找到表格`);
        }
      }

      state.data = {
        fetchedAt: new Date().toISOString(),
        semesters: semesters.sort((a, b) => compareTermsDesc(a.termLabel, b.termLabel))
      };
      saveSemesterCache(state.semesterCache);

      renderData(state.data);
      setStatus(`完成：${semesters.length} 學期`);
    } catch (error) {
      console.error('Grade Management: fetch failed', error);
      logDebug(`錯誤：${error && error.message ? error.message : '未知錯誤'}`);
      setStatus('抓取失敗，請重試', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchText(url) {
    const response = await fetch(url, {
      credentials: 'include'
    });
    return response.text();
  }

  async function fetchOffsetCredits() {
    try {
      const html = await fetchText(OFFSET_URL);
      const offset = parseOffsetCredits(html);
      state.offsetCredits = offset.credits;
      state.offsetCourses = offset.courses;
      logDebug(`抵免學分：${formatCredits(offset.credits)}`);
      logDebug(`抵免明細：${offset.courses.length} 門`);
    } catch (error) {
      console.warn('Grade Management: offset fetch failed', error);
      logDebug('抵免學分讀取失敗');
      state.offsetCredits = 0;
      state.offsetCourses = [];
    }
  }

  async function fetchDetail(formFields, action) {
    if (action.type === 'url') {
      return fetchText(action.url);
    }

    const form = new URLSearchParams();
    Object.entries(formFields).forEach(([name, value]) => {
      form.set(name, value);
    });

    if (action.type === 'event') {
      form.set('__EVENTTARGET', action.target);
      form.set('__EVENTARGUMENT', action.argument || '');
    } else if (action.type === 'image') {
      form.set(`${action.name}.x`, '1');
      form.set(`${action.name}.y`, '1');
    } else {
      form.set(`${action.name}.x`, '1');
      form.set(`${action.name}.y`, '1');
    }

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'include',
      body: form.toString()
    });

    return response.text();
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function collectFormFields(doc) {
    const form = doc.querySelector('form');
    if (!form) {
      const hiddenInputs = Array.from(doc.querySelectorAll('input[type="hidden"][name]'));
      return hiddenInputs.reduce((acc, input) => {
        acc[input.name] = input.value || '';
        return acc;
      }, {});
    }

    const fields = {};
    const elements = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));
    elements.forEach(el => {
      const name = el.name;
      if (!name) return;

      if (el.tagName === 'SELECT') {
        fields[name] = el.value || '';
        return;
      }

      if (el.tagName === 'TEXTAREA') {
        fields[name] = el.value || '';
        return;
      }

      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'file' || type === 'image' || type === 'submit' || type === 'button') return;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) return;

      fields[name] = el.value || '';
    });

    return fields;
  }

  function collectViewActions(doc) {
    const actions = [];
    const imageInputs = Array.from(doc.querySelectorAll('input[type="image"][name]'))
      .map(input => input.name)
      .filter(name => name && name.includes('GridView1') && name.includes('lbtnView'));
    if (imageInputs.length > 0) {
      logDebug(`候選按鈕：${imageInputs.length}`);
      logDebug(`候選名稱：${imageInputs.slice(0, 10).join(', ')}`);
    }
    const summaryTable = findSummaryTable(doc);

    if (summaryTable) {
      const headerCells = Array.from(summaryTable.querySelectorAll('tr th'));
      const headers = headerCells.map(cell => normalizeText(cell.textContent));
      const funcIndex = headers.indexOf('功能');
      const termIndex = headers.indexOf('學期');
      logDebug(`總表欄位：${headers.filter(Boolean).join('|')}`);

      const bodyRows = summaryTable.tBodies && summaryTable.tBodies.length > 0
        ? Array.from(summaryTable.tBodies[0].rows)
        : Array.from(summaryTable.querySelectorAll('tr'));
      const rows = bodyRows.filter(row => row.querySelectorAll('td').length > 0);
      logDebug(`總表列數：${rows.length}`);

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        const funcCell = funcIndex >= 0 && cells[funcIndex] ? cells[funcIndex] : row;
        const termText = termIndex >= 0 && cells[termIndex] ? normalizeText(cells[termIndex].textContent) : '';
        const yearterm = normalizeYearTerm(termText);
        if (yearterm) {
          actions.push({
            type: 'url',
            url: `${DETAIL_BASE_URL}&yearterm=${encodeURIComponent(yearterm)}`,
            termLabel: termText
          });
          logDebug(`學期 ${termText} -> ${yearterm}`);
          return;
        }

        const actionFromCell = extractActionFromCell(doc, funcCell);
        if (actionFromCell) actions.push(actionFromCell);
      });
    }

    if (actions.length > 0) return dedupeActions(actions);

    const links = Array.from(doc.querySelectorAll('a[href*="__doPostBack"]'));
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const action = extractPostBackAction(href);
      if (action && action.target.includes('GridView1') && action.target.includes('lbtnView')) {
        actions.push(action);
      }
    });

    if (actions.length > 0) return dedupeActions(actions);

    if (imageInputs.length > 0) {
      return imageInputs.map(name => ({ type: 'image', name }));
    }

    return [];
  }

  function parseSemesterDetail(html) {
    const doc = parseHtml(html);
    const table = findCourseTable(doc);
    if (!table) return null;

    const headerCells = Array.from(table.querySelectorAll('thead th, tr.table_tital th'));
    const headers = headerCells.map(cell => normalizeText(cell.textContent));
    logDebug(`表頭：${headers.filter(Boolean).join('|')}`);

    const rows = Array.from(table.querySelectorAll('tr'))
      .filter(row => row.querySelectorAll('td').length > 0);
    logDebug(`表格列數：${rows.length}`);

    const courses = rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const values = cells.map(cell => normalizeText(cell.textContent));

      if (values.length > 0) {
        logDebug(`列值：${values.join('|')}`);
      }

      const data = mapRow(headers, values);
      const course = {
        index: pickValue(data, headers, values, ['筆'], 0),
        term: pickValue(data, headers, values, ['學期'], 1),
        code: pickValue(data, headers, values, ['課號'], 2),
        department: pickValue(data, headers, values, ['開課單位', '開課系所'], 3),
        name: pickValue(data, headers, values, ['課程名稱', '科目'], 4),
        type: pickValue(data, headers, values, ['選別', '選課別'], 5),
        credits: pickValue(data, headers, values, ['學分'], 6),
        grade: data['等級成績'] || '',
        status: pickValue(data, headers, values, ['成績狀態', '狀態'], 8),
        teacher: pickValue(data, headers, values, ['任課老師', '教師'], 9),
        dimension: pickValue(data, headers, values, ['向度', '領域'], 10)
      };

      return isValidCourseRow(course) ? course : null;
    }).filter(Boolean);

    const termLabel = courses.length > 0 ? courses[0].term : '未知';

    return {
      termLabel,
      courses,
      summary: parseSummary(doc)
    };
  }

  function parseOffsetCredits(html) {
    const doc = parseHtml(html);
    const table = findOffsetTable(doc);
    if (!table) return { credits: 0, courses: [] };

    const spanData = parseOffsetSpans(table);
    if (spanData.courses.length > 0) {
      return spanData;
    }

    const headerCells = Array.from(table.querySelectorAll('tr th'));
    const headers = headerCells.map(cell => normalizeText(cell.textContent));
    const creditIndex = headers.findIndex(header => header.includes('抵免本校') || header.includes('學分'));
    if (creditIndex === -1) return { credits: 0, courses: [] };

    const bodyRows = table.tBodies && table.tBodies.length > 0
      ? Array.from(table.tBodies[0].rows)
      : Array.from(table.querySelectorAll('tr'));

    const credits = bodyRows.reduce((sum, row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length === 0 || !cells[creditIndex]) return sum;
      return sum + parseCredits(cells[creditIndex].textContent);
    }, 0);

    return { credits, courses: [] };
  }

  function parseOffsetSpans(table) {
    const nameSpans = Array.from(table.querySelectorAll('span[id$="lblPCName"]'));
    const creditSpans = Array.from(table.querySelectorAll('span[id$="lblCredit"]'));
    if (nameSpans.length === 0 && creditSpans.length === 0) {
      return { credits: 0, courses: [] };
    }

    const creditMap = new Map();
    creditSpans.forEach(span => {
      const id = span.getAttribute('id') || '';
      const key = id.replace(/_lblCredit$/, '');
      creditMap.set(key, parseCredits(span.textContent));
    });

    const courses = nameSpans.map(span => {
      const id = span.getAttribute('id') || '';
      const key = id.replace(/_lblPCName$/, '');
      return {
        name: normalizeText(span.textContent),
        credits: creditMap.get(key) || 0
      };
    }).filter(item => item.name);

    const credits = courses.reduce((sum, item) => sum + item.credits, 0);
    return { credits, courses };
  }

  function findOffsetTable(doc) {
    const bySpans = Array.from(doc.querySelectorAll('table')).find(table =>
      table.querySelector('span[id$="lblPCName"]') && table.querySelector('span[id$="lblCredit"]')
    );
    if (bySpans) return bySpans;

    const tables = Array.from(doc.querySelectorAll('table'));
    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('tr th'));
      if (headerCells.length === 0) continue;
      const headers = headerCells.map(cell => normalizeText(cell.textContent));
      const hasCredit = headers.some(header => header.includes('學分'));
      const hasOffset = headers.some(header => header.includes('抵免'));
      if (hasCredit && hasOffset) return table;
    }
    return null;
  }

  function findCourseTable(doc) {
    const preferred = doc.querySelector('#divWorking #trGrid table#GridView1');
    if (preferred) return preferred;

    const headerLabel = doc.querySelector('#Label6');
    if (headerLabel) {
      const container = headerLabel.closest('table');
      if (container) {
        const table = container.querySelector('table#GridView1');
        if (table) return table;
      }
    }

    const candidates = Array.from(doc.querySelectorAll('table#GridView1, table.table'));
    for (const table of candidates) {
      if (hasCourseHeaders(table)) return table;
    }

    return null;
  }

  function findSummaryTable(doc) {
    const preferred = doc.querySelector('table#GridView1');
    if (preferred && hasSummaryHeaders(preferred)) return preferred;

    const tables = Array.from(doc.querySelectorAll('table'));
    for (const table of tables) {
      if (hasSummaryHeaders(table)) return table;
    }
    return null;
  }

  function hasSummaryHeaders(table) {
    if (!table) return false;
    const headerCells = Array.from(table.querySelectorAll('tr th'));
    const headers = headerCells.map(cell => normalizeText(cell.textContent));
    return headers.includes('系所組班') && headers.includes('等第積分平均') && headers.includes('學期');
  }

  function extractActionFromCell(doc, funcCell) {
    if (!funcCell) return null;

    const clickable = funcCell.querySelector('a[href], button[onclick], input[onclick], input[type="image"][name]');
    if (!clickable) return null;

    const href = clickable.getAttribute('href') || '';
    const onclick = clickable.getAttribute('onclick') || '';

    if (href) {
      const postback = extractPostBackAction(href);
      if (postback) return postback;
      if (!href.startsWith('javascript:')) {
        return { type: 'url', url: new URL(href, BASE_URL).href };
      }
    }

    if (onclick) {
      const postback = extractPostBackAction(onclick);
      if (postback) return postback;

      const clickMatch = onclick.match(/clickPageButton\('([^']+)'\)/);
      if (clickMatch) {
        const targetId = clickMatch[1];
        const targetEl = doc.getElementById(targetId);
        if (targetEl && targetEl.name) {
          if (targetEl.type === 'image') {
            return { type: 'image', name: targetEl.name };
          }
          if (targetEl.type === 'submit' || targetEl.type === 'button') {
            return { type: 'event', target: targetEl.name || targetEl.id, argument: '' };
          }
        }
      }
    }

    const imgInput = funcCell.querySelector('input[type="image"][name]');
    if (imgInput && imgInput.name) {
      return { type: 'image', name: imgInput.name };
    }

    return null;
  }

  function extractPostBackAction(source) {
    const match = source.match(/__doPostBack\('([^']+)','([^']*)'\)/);
    if (!match) return null;
    const target = match[1];
    return target ? { type: 'event', target, argument: match[2] || '' } : null;
  }

  function hasCourseHeaders(table) {
    if (!table) return false;
    const headerCells = Array.from(table.querySelectorAll('th'));
    const headers = headerCells.map(cell => normalizeText(cell.textContent));
    return headers.includes('課號') && headers.includes('課程名稱') && headers.includes('學期');
  }

  function mapRow(headers, values) {
    const result = {};
    headers.forEach((header, index) => {
      result[header] = values[index] || '';
    });
    return result;
  }

  function pickValue(data, headers, values, candidates, fallbackIndex) {
    for (const candidate of candidates) {
      if (data[candidate]) return data[candidate];
    }

    const normalizedHeaders = headers.map(text => normalizeHeader(text));
    for (const candidate of candidates) {
      const idx = normalizedHeaders.findIndex(header => header.includes(normalizeHeader(candidate)));
      if (idx >= 0 && values[idx]) return values[idx];
    }

    return values[fallbackIndex] || '';
  }

  function normalizeHeader(text) {
    return normalizeText(text).replace(/\s+/g, '');
  }

  function isValidCourseRow(course) {
    if (!course) return false;
    const code = normalizeText(course.code).toUpperCase();
    const name = normalizeText(course.name);
    const teacher = normalizeText(course.teacher);
    const status = normalizeText(course.status);
    const grade = normalizeText(course.grade);
    const term = normalizeText(course.term);

    if (!code || code === '在學') return false;
    if (!name && !teacher) return false;
    if (grade.includes('%') || status.includes('%')) return false;

    return true;
  }

  function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeYearTerm(termText) {
    if (!termText) return '';
    const text = normalizeText(termText);
    if (/^\d{4}$/.test(text)) return text;

    const yearMatch = text.match(/\d{3}/);
    if (!yearMatch) return '';
    const year = yearMatch[0];

    if (/^\d{3}上$/.test(text)) return `${year}1`;
    if (/^\d{3}下$/.test(text)) return `${year}2`;
    if (/^\d{3}暑$/.test(text)) return `${year}3`;
    if (/^\d{3}寒$/.test(text)) return `${year}0`;

    return '';
  }

  function compareTermsDesc(a, b) {
    const aValue = termSortValue(a);
    const bValue = termSortValue(b);
    return bValue - aValue;
  }

  function termSortValue(label) {
    if (!label) return 0;
    const text = normalizeText(label);
    const numeric = text.match(/^(\d{3,4})(\d)$/);
    if (numeric) {
      return Number.parseInt(`${numeric[1]}${numeric[2]}`, 10);
    }
    const yearMatch = text.match(/\d{3}/);
    if (!yearMatch) return 0;
    const year = yearMatch[0];
    const term = text.includes('上') ? 1
      : text.includes('下') ? 2
        : text.includes('暑') ? 3
          : text.includes('寒') ? 0
            : 0;
    return Number.parseInt(`${year}${term}`, 10);
  }

  function parseSummary(doc) {
    const summaryText = normalizeText(doc.body.textContent);
    const summary = {
      totalCredits: matchLabel(summaryText, '修課學分'),
      earnedCredits: matchLabel(summaryText, '實得學分'),
      average: matchLabel(summaryText, '平均'),
      rank: matchLabel(summaryText, '名次'),
      classSize: matchLabel(summaryText, '班級人數')
    };

    const hasAny = Object.values(summary).some(value => value !== '');
    return hasAny ? summary : null;
  }

  function matchLabel(text, label) {
    const regex = new RegExp(`${label}[:：]?\\s*([\\d.%\\-~]+)`);
    const match = text.match(regex);
    return match ? match[1] : '';
  }

  function logDebug(message) {
    const timestamp = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    state.debug.push(`[${timestamp}] ${message}`);
    if (state.debug.length > 200) {
      state.debug.shift();
    }
    renderDebug();
  }

  function dedupeActions(actions) {
    const seen = new Set();
    return actions.filter(action => {
      const key = formatAction(action);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function formatAction(action) {
    if (action.type === 'event') return action.target;
    if (action.type === 'image') return action.name;
    if (action.type === 'url') return action.url;
    return action.type || 'unknown';
  }

  function describeAction(action) {
    return `${action.type}:${formatAction(action)}`;
  }

  function clearDebug() {
    state.debug = [];
    renderDebug();
  }

  function renderDebug() {
    const debugEl = document.getElementById('gm-debug');
    if (!debugEl) return;
    if (state.debug.length === 0) {
      debugEl.textContent = '';
      return;
    }
    debugEl.innerHTML = state.debug.map(line => `<div>${escapeHtml(line)}</div>`).join('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
