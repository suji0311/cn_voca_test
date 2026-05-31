# 중국어 시험 자동 채점 사이트
https://suji0311.github.io/cn_voca_test/

Supabase 저장 방식으로 구성된 정적 웹앱입니다.

## 주소 분리

- 학생 응시 화면: `index.html`
- 교수자 관리 화면: `admin.html`

## Supabase 연결 순서

1. Supabase 프로젝트를 생성합니다.
2. Supabase Dashboard > SQL Editor에서 `supabase-schema.sql` 전체를 실행합니다.
3. Supabase Dashboard > Project Settings > API에서 Project URL과 anon public key를 확인합니다.
4. `config.js`에 값을 입력합니다.

```js
const SUPABASE_CONFIG = {
  url: "https://프로젝트ID.supabase.co",
  anonKey: "anon public key"
};
```

Project URL은 `https://...supabase.co` 형태입니다. `https://supabase.com/dashboard/...`로 시작하는 대시보드 주소를 넣으면 안 됩니다.

## 교수자 계정 등록

1. Supabase Dashboard > Authentication > Users에서 교수자 이메일 계정을 생성합니다.
2. 생성된 User UID를 복사합니다.
3. SQL Editor에서 아래 SQL을 실행합니다.

```sql
insert into public.admin_profiles (user_id, display_name)
values ('복사한_USER_UID', '담당 교수')
on conflict (user_id) do update
set display_name = excluded.display_name;
```

## 기본 샘플 응시 정보

- 이름: `김민지`
- 학번: `20240101`
- 분반: `A`
- 시험명: `중간고사 1차`

## 저장 위치

- 입력 중 답안: Supabase `attempts` 테이블
- 제출 완료 답안: Supabase `submissions` 테이블
- 등록 학생: Supabase `registered_students` 테이블
- 시험/문항: Supabase `exams`, `exam_sections`, `questions` 테이블

학생은 등록 정보가 일치해야 RPC 함수로 시험 정보를 받을 수 있고, 교수자는 Supabase Auth 로그인 후 `admin_profiles`에 등록된 계정만 관리 화면에 접근할 수 있습니다.

## 사이트 안에서 가능한 교수자 작업

교수자는 `admin.html` 로그인 후 Supabase 대시보드에 들어가지 않고도 아래 작업을 할 수 있습니다.

- 학생 등록 및 기존 학생 정보 갱신
- 새 시험 생성
- A/B 분반별 제한시간 설정
- 자동채점/수동채점 문항 추가
- 제출 답안 확인
- 서술형/작문 문항 수동 점수 입력

Supabase 대시보드는 최초 설치, 교수자 계정 생성, `config.js` 설정 때만 필요합니다.
