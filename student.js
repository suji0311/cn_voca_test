const state = {
  student: null,
  exam: null,
  questions: [],
  answers: {},
  deadline: null,
  timer: null,
  saving: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", () => {
  bindStudentFlow();
});

function bindStudentFlow() {
  $("#accessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#accessMessage").textContent = "";

    try {
      requireSupabaseConfig();
      if (!supabaseApp) throw window.supabaseInitError;
      const form = event.currentTarget;
      const request = {
        p_name: form.studentName.value.trim(),
        p_student_number: form.studentId.value.trim(),
        p_section: form.section.value,
        p_exam_title: form.examTitle.value.trim()
      };

      const { data, error } = await supabaseApp.rpc("verify_student_access", request);
      if (error) throw error;
      if (!data?.allowed) {
        $("#accessMessage").textContent =
          data?.message || "등록 정보가 일치하지 않아 응시할 수 없습니다.";
        return;
      }

      startExam(data);
    } catch (error) {
      $("#accessMessage").textContent = error.message;
    }
  });

  $("#submitExam").addEventListener("click", () => submitExam(false));
  $("#newAttempt").addEventListener("click", resetStudentView);
}

function startExam(data) {
  state.student = data.student;
  state.exam = data.exam;
  state.questions = data.questions;
  state.answers = data.attempt?.answers || {};
  state.deadline = new Date(data.attempt?.deadline || data.deadline).getTime();

  renderExam();
  $("#gatePanel").classList.add("hidden");
  $("#resultPanel").classList.add("hidden");
  $("#examPanel").classList.remove("hidden");
  startTimer();
}

function renderExam() {
  $("#examMeta").textContent = `${state.student.name} · ${state.student.student_number} · ${state.student.section}분반`;
  $("#examName").textContent = state.exam.title;
  $("#examForm").innerHTML = state.questions
    .map((question, index) => {
      const value = state.answers[question.id] || "";
      const input =
        question.type === "manual"
          ? `<textarea data-question="${question.id}" placeholder="답안을 입력하세요">${escapeHtml(value)}</textarea>`
          : `<input data-question="${question.id}" value="${escapeHtml(value)}" placeholder="답안을 입력하세요" />`;

      return `
        <article class="question">
          <div class="question-head">
            <div>
              <div class="question-title">${index + 1}. ${question.category} (${question.points}점)</div>
              <p class="question-prompt">${question.prompt}</p>
            </div>
            <span class="badge ${question.type === "manual" ? "manual" : ""}">
              ${question.type === "manual" ? "수동채점" : "자동채점"}
            </span>
          </div>
          ${input}
        </article>`;
    })
    .join("");

  $$("[data-question]").forEach((input) => {
    input.addEventListener("input", () => {
      state.answers[input.dataset.question] = input.value;
      queueSaveAttempt();
    });
  });
}

function queueSaveAttempt() {
  clearTimeout(state.saving);
  state.saving = setTimeout(saveAttempt, 450);
}

async function saveAttempt() {
  try {
    const { error } = await supabaseApp.rpc("save_student_attempt", {
      p_student_id: state.student.id,
      p_exam_id: state.exam.id,
      p_answers: state.answers,
      p_deadline: new Date(state.deadline).toISOString()
    });
    if (error) throw error;
    flashSaved("답안 자동 저장됨");
  } catch (error) {
    flashSaved(`저장 실패: ${error.message}`);
  }
}

function startTimer() {
  clearInterval(state.timer);
  updateTimer();
  state.timer = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const remaining = Math.max(0, state.deadline - Date.now());
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  $("#timeLeft").textContent = `${minutes}:${seconds}`;

  if (remaining <= 0) {
    clearInterval(state.timer);
    submitExam(true);
  }
}

async function submitExam(isAutoSubmit) {
  $$("[data-question]").forEach((input) => {
    state.answers[input.dataset.question] = input.value;
  });

  const graded = gradeAttempt(state.answers);
  const payload = {
    p_student_id: state.student.id,
    p_exam_id: state.exam.id,
    p_answers: state.answers,
    p_auto_score: graded.autoScore,
    p_auto_max: graded.autoMax,
    p_manual_max: graded.manualMax,
    p_details: graded.details,
    p_auto_submitted: isAutoSubmit
  };

  try {
    const { error } = await supabaseApp.rpc("submit_student_exam", payload);
    if (error) throw error;
    clearInterval(state.timer);
    renderResult({
      autoScore: graded.autoScore,
      autoMax: graded.autoMax,
      manualMax: graded.manualMax,
      details: graded.details
    });
  } catch (error) {
    flashSaved(`제출 실패: ${error.message}`);
  }
}

function gradeAttempt(answers) {
  return state.questions.reduce(
    (result, question) => {
      const answer = normalize(answers[question.id]);
      if (question.type === "manual") {
        result.manualMax += question.points;
        result.details.push({ question, status: "pending", answer });
        return result;
      }

      result.autoMax += question.points;
      const correct = (question.accepted_answers || []).some(
        (accepted) => normalize(accepted) === answer
      );
      if (correct) result.autoScore += question.points;
      result.details.push({ question, status: correct ? "correct" : "wrong", answer });
      return result;
    },
    { autoScore: 0, autoMax: 0, manualMax: 0, details: [] }
  );
}

function renderResult(submission) {
  $("#examPanel").classList.add("hidden");
  $("#resultPanel").classList.remove("hidden");
  $("#scoreSummary").innerHTML = `
    <div class="score-box"><span>자동 채점</span><strong>${submission.autoScore}/${submission.autoMax}</strong></div>
    <div class="score-box"><span>수동 채점 대기</span><strong>${submission.manualMax}점</strong></div>
  `;
  $("#resultDetails").innerHTML = submission.details
    .map(({ question, status, answer }) => {
      const label =
        status === "pending" ? "교수자 채점 대기" : status === "correct" ? "정답" : "오답";
      return `
        <article class="result-item ${status}">
          <strong>${question.category} · ${question.points}점 · ${label}</strong>
          <p>${question.prompt}</p>
          <p>제출 답안: ${escapeHtml(answer || "미입력")}</p>
        </article>`;
    })
    .join("");
}

function resetStudentView() {
  $("#accessForm").reset();
  $("#accessMessage").textContent = "";
  $("#gatePanel").classList.remove("hidden");
  $("#examPanel").classList.add("hidden");
  $("#resultPanel").classList.add("hidden");
}

function flashSaved(message) {
  const notice = $("#saveNotice");
  notice.textContent = message;
  notice.classList.add("saved");
  clearTimeout(flashSaved.timeout);
  flashSaved.timeout = setTimeout(() => notice.classList.remove("saved"), 700);
}

function normalize(value = "") {
  return value.toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeHtml(value = "") {
  return value
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
