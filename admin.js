const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let cachedExams = [];

document.addEventListener("DOMContentLoaded", async () => {
  bindAdminFlow();
  try {
    requireSupabaseConfig();
    if (!supabaseApp) throw window.supabaseInitError;
    const { data } = await supabaseApp.auth.getSession();
    if (data.session) await showAdmin();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  }
});

function bindAdminFlow() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#loginMessage").textContent = "";
    try {
      requireSupabaseConfig();
      if (!supabaseApp) throw window.supabaseInitError;
      const form = event.currentTarget;
      const { error } = await supabaseApp.auth.signInWithPassword({
        email: form.email.value.trim(),
        password: form.password.value
      });
      if (error) throw error;
      await showAdmin();
    } catch (error) {
      $("#loginMessage").textContent = error.message;
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
    await supabaseApp.auth.signOut();
    $("#adminPanel").classList.add("hidden");
    $("#loginPanel").classList.remove("hidden");
  });

  $("#studentForm").addEventListener("submit", saveStudent);
  $("#examForm").addEventListener("submit", saveExam);
  $("#questionForm").addEventListener("submit", saveQuestion);
}

async function showAdmin() {
  const { data: isAdmin, error: adminError } = await supabaseApp.rpc("current_user_is_admin");
  if (adminError) throw adminError;
  if (!isAdmin) {
    await supabaseApp.auth.signOut();
    throw new Error("교수자 권한이 없는 계정입니다.");
  }

  $("#loginPanel").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
  await renderTeacherData();
}

async function saveStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    name: form.name.value.trim(),
    student_number: form.studentNumber.value.trim(),
    section: form.section.value.trim()
  };

  try {
    const { error } = await supabaseApp
      .from("registered_students")
      .upsert(payload, { onConflict: "student_number,section" });
    if (error) throw error;
    form.reset();
    showAdminMessage("학생 정보를 저장했습니다.");
    await renderTeacherData();
  } catch (error) {
    showAdminMessage(error.message);
  }
}

async function saveExam(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const { data: exam, error } = await supabaseApp
      .from("exams")
      .upsert(
        { title: form.title.value.trim(), is_active: true },
        { onConflict: "title" }
      )
      .select()
      .single();
    if (error) throw error;

    const sections = [
      { exam_id: exam.id, section: "A", minutes: Number(form.sectionA.value) },
      { exam_id: exam.id, section: "B", minutes: Number(form.sectionB.value) }
    ];

    const { error: sectionError } = await supabaseApp
      .from("exam_sections")
      .upsert(sections, { onConflict: "exam_id,section" });
    if (sectionError) throw sectionError;

    form.reset();
    showAdminMessage("시험과 분반별 시간을 저장했습니다.");
    await renderTeacherData();
  } catch (error) {
    showAdminMessage(error.message);
  }
}

async function saveQuestion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const selectedExam = cachedExams.find((exam) => exam.id === form.examId.value);
  const nextOrder = (selectedExam?.questions || []).length + 1;
  const acceptedAnswers = form.acceptedAnswers.value
    .split(/\r?\n/)
    .map((answer) => answer.trim())
    .filter(Boolean);

  const payload = {
    exam_id: form.examId.value,
    sort_order: nextOrder,
    type: form.type.value,
    category: form.category.value.trim(),
    prompt: form.prompt.value.trim(),
    points: Number(form.points.value),
    accepted_answers: form.type.value === "auto" ? acceptedAnswers : []
  };

  try {
    const { error } = await supabaseApp.from("questions").insert(payload);
    if (error) throw error;
    form.reset();
    showAdminMessage("문항을 추가했습니다.");
    await renderTeacherData();
  } catch (error) {
    showAdminMessage(error.message);
  }
}

async function renderTeacherData() {
  const [{ data: students, error: studentsError }, { data: exams, error: examsError }] =
    await Promise.all([
      supabaseApp.from("registered_students").select("*").order("section").order("student_number"),
      supabaseApp
        .from("exams")
        .select("*, exam_sections(section, minutes), questions(id, sort_order, type, category, points, prompt)")
        .order("created_at", { ascending: false })
    ]);

  if (studentsError) throw studentsError;
  if (examsError) throw examsError;

  cachedExams = exams.map((exam) => ({
    ...exam,
    questions: [...(exam.questions || [])].sort((a, b) => a.sort_order - b.sort_order),
    exam_sections: [...(exam.exam_sections || [])].sort((a, b) =>
      a.section.localeCompare(b.section)
    )
  }));

  renderRoster(students);
  renderExams(cachedExams);
  renderQuestionExamOptions(cachedExams);
  await renderSubmissions();
}

function renderRoster(students) {
  $("#rosterList").innerHTML = students.length
    ? students
        .map(
          (student) => `
        <div class="compact-item">
          <strong>${student.name}</strong>
          <p>${student.student_number} · ${student.section}분반</p>
        </div>`
        )
        .join("")
    : `<div class="empty">등록된 학생이 없습니다.</div>`;
}

function renderExams(exams) {
  $("#examConfig").innerHTML = exams.length
    ? exams
        .map((exam) => {
          const sections = exam.exam_sections
            .map((section) => `${section.section}분반 ${section.minutes}분`)
            .join(" · ");
          const autoCount = exam.questions.filter((question) => question.type === "auto").length;
          const manualCount = exam.questions.filter((question) => question.type === "manual").length;
          const questions = exam.questions
            .map(
              (question) =>
                `<p>${question.sort_order}. ${question.category} · ${question.points}점 · ${
                  question.type === "auto" ? "자동" : "수동"
                }</p>`
            )
            .join("");

          return `
          <div class="compact-item">
            <strong>${exam.title}</strong>
            <p>${sections || "분반 시간이 없습니다."}</p>
            <p>자동 ${autoCount}문항 · 수동 ${manualCount}문항</p>
            ${questions}
          </div>`;
        })
        .join("")
    : `<div class="empty">등록된 시험이 없습니다.</div>`;
}

function renderQuestionExamOptions(exams) {
  $("#questionExamSelect").innerHTML = exams.length
    ? exams
        .map((exam) => `<option value="${exam.id}">${escapeHtml(exam.title)}</option>`)
        .join("")
    : `<option value="">먼저 시험을 생성하세요</option>`;
}

async function renderSubmissions() {
  const { data: submissions, error } = await supabaseApp
    .from("submissions")
    .select("*, registered_students(name, student_number, section), exams(title)")
    .order("submitted_at", { ascending: false });

  if (error) throw error;

  $("#submissionList").innerHTML = submissions.length
    ? submissions.map(renderSubmission).join("")
    : `<div class="empty">아직 제출된 답안이 없습니다.</div>`;

  $$(".grade-input").forEach((input) => {
    input.addEventListener("change", () => updateManualScore(input));
  });
}

function renderSubmission(submission) {
  const totalManual = Object.values(submission.manual_scores || {}).reduce(
    (sum, score) => sum + Number(score || 0),
    0
  );
  const total = submission.auto_score + totalManual;
  const max = submission.auto_max + submission.manual_max;
  const submittedTime = new Date(submission.submitted_at).toLocaleString("ko-KR");
  const manualQuestions = (submission.details || []).filter(
    ({ question }) => question.type === "manual"
  );
  const manualHtml = manualQuestions
    .map(({ question, answer }) => {
      const score = submission.manual_scores?.[question.id] ?? "";
      return `
        <div class="manual-grade">
          <label>
            ${question.category} (${question.points}점)
            <textarea readonly>${escapeHtml(answer || "미입력")}</textarea>
          </label>
          <label>
            점수
            <input class="grade-input" type="number" min="0" max="${question.points}" step="0.5"
              value="${score}" data-submission="${submission.id}" data-question="${question.id}" />
          </label>
        </div>`;
    })
    .join("");

  return `
    <article class="submission">
      <div class="submission-head">
        <div>
          <h3>${submission.registered_students.name} · ${submission.registered_students.student_number}</h3>
          <p>${submission.exams.title} · ${submission.registered_students.section}분반 · ${submittedTime}</p>
        </div>
        <div class="score-box"><span>총점</span><strong>${total}/${max}</strong></div>
      </div>
      <p>자동 채점 점수: ${submission.auto_score}/${submission.auto_max}</p>
      ${submission.auto_submitted ? "<p>시간 종료로 자동 제출되었습니다.</p>" : ""}
      ${manualHtml || "<p>수동 채점 문항이 없습니다.</p>"}
    </article>`;
}

async function updateManualScore(input) {
  const { data: submission, error } = await supabaseApp
    .from("submissions")
    .select("manual_scores")
    .eq("id", input.dataset.submission)
    .single();

  if (error) throw error;

  const scores = submission.manual_scores || {};
  const max = Number(input.max);
  scores[input.dataset.question] = Math.max(0, Math.min(max, Number(input.value || 0)));

  const { error: updateError } = await supabaseApp
    .from("submissions")
    .update({ manual_scores: scores })
    .eq("id", input.dataset.submission);

  if (updateError) throw updateError;
  await renderSubmissions();
}

function showAdminMessage(message) {
  $("#adminMessage").textContent = message;
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
