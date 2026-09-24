# DYAD

브라우저 리듬게임. osu!taiko 채보를 결정적으로 변환해 쓰는 2타입(돈/캇) 게임.
키는 4개(KK/DD)지만 손은 자유이고, 왕노트만 양손 동시타를 요구한다.
서버 없이 정적 호스팅으로 동작하며, 이후 Supabase(OAuth + Postgres)를 붙일 여지를 남긴다.

이름 유래: dyad = 두 음으로 된 화음. 두 타입, 두 손, 위아래 두 줄. (ennea = 9 와 같은 그리스어 계열)

---

## 1. 확정된 제약

| 항목 | 결정 |
|---|---|
| GitHub 계정 | **frontishobby** (ennea 와 동일, david02324 사용 금지). 첫 커밋 전 확인 |
| 프레임워크 | Vite + Svelte 5 + TypeScript |
| 렌더러 | PixiJS v8 (게임 캔버스). UI 셸은 Svelte |
| 타이밍 | Web Audio `AudioContext.currentTime` 기준 직접 구현. Phaser 등 게임 엔진 사용 안 함 |
| 호스팅 | 정적 (GitHub Pages / Vercel / Cloudflare Pages 중 택1) |
| 백엔드 | **지금은 없음.** `backend/` 인터페이스만 두고 LocalBackend 로 시작. §12 |
| 음원 | **webm (Opus 128k) 단일.** 폴백 파일 없음, 프로브 디코드 실패 시 안내 |
| 이미지 | **AVIF 단일.** 래스터는 자켓/배경뿐, 게임 요소는 Pixi Graphics |
| 채보 | Mapperatorinator 로 osu!taiko `.osu` 생성 → 빌드 타임 Node 변환 → `chart.json` |
| 지원 범위 | iOS 18.4+, 최신 Chrome/Firefox/Edge. 그 이하는 안내만 |
| 커밋 | AI author / Co-Authored-By 트레일러 금지 |

---

## 2. 게임 룰

### 입력
- 키 4개. 패드는 2×2:
  ```
  K K   ← 위 행 = 캇 (왼손, 오른손)
  D D   ← 아래 행 = 돈 (왼손, 오른손)
  ```
- 열 = 손, 행 = 타입. **일반 노트는 어느 손으로 쳐도 된다.** 타입만 맞으면 됨
- **왕노트는 같은 타입 두 키(양손).** 첫 키로 타이밍을 재고, 같은 타입의 두 번째 키가 30ms 안에 오면 그 타이밍대로 판정(Great 가능). 한 손만 치면 **OK 로 고정**. 옵션 없음, 모든 노트의 점수 가중치는 같다
- 키보드 기본: 왼손 `Z`(캇) `X`(돈), 오른손 `M`(돈) `,`(캇). 바깥 키가 캇, 안쪽 키가 돈. 설정에서 변경 가능
- 게임패드: 프레임 폴링. 한 프레임 지연 감수
- 터치(세로): 하단 35~40% 를 2×2 존으로

### 판정
- 3단계 고정: **Great ±30ms / OK ±50ms / 그 밖은 Miss.** 채보의 OD 는 판정에 쓰지 않는다 (표시용으로만 보관). ±50ms 밖의 입력은 노트를 건드리지 않고, 노트는 +50ms 를 지나면 Miss
- 판정 창 안의 **가장 이른 미판정 노트**를 잡고, 타입이 다르면 그 노트를 Miss 처리 (taiko 룰)
- Miss 확정은 프레임 루프에서: `songMs > note.t + missWindow`
- 드럼롤(슬라이더): **유지.** 구간 동안 아무 키나 연타. 롤 하나는 노트 하나와 같은 무게이고, 롤 템포의 8분음표당 1타(`expectedRollTicks`)를 채우면 만점, 그 이하는 비례. Miss·콤보 영향 없음
- 스피너(덴덴): **유지.** 돈/캇 교대 연타, 필요 타수는 변환 시 길이·OD 로 계산. 스피너 하나는 노트 하나와 같은 무게이고 타수 비례로 채워진다. Miss·콤보 영향 없음. 정확도(accuracy)는 노트만으로 계산
- 점수: 정확도 기반 1,000,000 만점 (osu!lazer 식). 콤보는 표시용

---

## 3. 화면 설계

### 트랙 규칙 (두 모드 공통)
트랙 폭이 담을 수 있는 축은 하나뿐이다. **폭 = 손, 타입 = 색 + 모양** 으로 고정한다.
레인을 타입으로 나누면 왕노트가 "돈+캇" 으로 읽히는 문제가 생기므로 금지.

- 트랙 왼쪽 절반 = 왼손, 오른쪽 절반 = 오른손 (패드의 두 열과 일치)
- **일반 노트**: 중앙에 트랙 폭 60% 로 하나. 특정 레인에 넣으면 "이 손으로 쳐라" 는 거짓 정보가 됨
- **왕노트**: 같은 타입 두 개를 좌우로 나란히, 사이를 바로 이어 트랙 전체 폭. 패드 한 행의 두 칸을 그대로 그린 형태
- **타입 모양**: 캇 = 위 행이니 위로 뾰족한 캡/링, 돈 = 아래 행이니 납작한 블록. 색은 보조
- **판정선 = 패드 미니어처(게이트)**: 2×2 게이트를 판정선 자리에 두고, 친 손의 열과 친 타입의 행이 빛난다
- 마디선/박자선은 타이밍 포인트에서 그린다. 스크롤은 SV 무시, **시간 기준 등속**. 하이스피드 옵션으로만 조절

### 세로 모드 (터치)
- 노트가 위에서 아래로 떨어져 터치존 바로 위 판정선(게이트)에 닿는다
- 트랙 높이 ≈ 화면 60%, 선행 시간 600~900ms
- 상단: 자켓(소), 제목, 진행바, 점수. 하단 35~40%: 2×2 터치존
- `touch-action: none`, `user-select: none`, 전체화면 API, 가능한 기기에서 orientation lock

### 가로 모드 (키보드/게임패드)
- 같은 트랙을 90° 눕혀 오른쪽→왼쪽. 판정 게이트는 왼쪽 20% 지점
- 폭 축이 위/아래가 되므로 위 절반 = 왼손, 아래 절반 = 오른손. 타입은 모양으로
- 남는 공간에 자켓(대), 점수, 콤보

### 렌더 좌표
- 렌더러는 **트랙 로컬 좌표**(진행 축 + 폭 축)만 알고, 레이아웃이 방향/위치만 정한다 → 코드 한 벌
- **가로: 1280×720 고정.** 비율 유지 스케일 + 레터박스, 업스케일 금지 (ennea 와 같은 이유: 물리 크기가 기기마다 달라지면 체감 난이도가 달라진다)
- **세로: 동적 해상도.** 논리 폭 720, 논리 높이 = 720 × 화면 비율(960~1920). 캔버스가 화면을 꽉 채운다. 터치는 어차피 기기 크기에 종속이라 고정 해상도의 이점이 없고, 레터박스는 터치존을 잘라먹는다. 리사이즈(주소창 접힘 등) 시 레이아웃 재계산

### 기각/보류한 대안 (기록용)
- **줄바꿈 재생헤드 방식 (초기 목업)**: 줄 전환 시 시선 점프 + 세로 화면 폭이 좁아 선행 시간 부족. 기각
- **레인 = 타입 (돈 레인/캇 레인)**: 왕노트 의미 충돌. 기각
- **링 스위프**: 원형 트랙 위를 재생헤드가 돌고 한 바퀴 = 1~2마디. 점프 없고 독특하지만 하이스피드 개념이 없어 오니 채보 읽기 불가. 쉬운 난이도용 비주얼 모드로 보류
- **뱀길 스크롤**: S자 경로 하나로 잇고 판정점 고정. 굽는 구간에서 체감 속도 변화. 기각
- **손 강제 모드 (진짜 4K)**: 변환기가 손을 결정적으로 배정(연타 좌우 교대, 왕노트 양손), 레인 = 손, 색 = 행. taiko 채보는 손 배정을 염두에 두지 않아 1/3, 1/6 에서 억지 배정 발생. 나중에 모드 하나로 보류

---

## 4. 채보 파이프라인

```
음원 ──► colab/dyad_taiko_generate.ipynb ──► songs-src/<id>/{easy,normal,hard}.osu + song.wav
         (Mapperatorinator V32 taiko 체크포인트,          │
          티어마다 생성, 헤더만 손봄)                       │  tools/build-songs.ts (빌드 타임, tools/convert-osu.ts)
                                                        ▼
                                          public/songs/<id>/chart.<tier>.json
```

### `.osu` → 노트 변환 규칙
- `[HitObjects]` 각 줄: `x,y,time,type,hitSound,objectParams,hitSample`
- 타입: `hitSound` 에 whistle(2) 또는 clap(8) 비트 → **캇**, 아니면 **돈**. finish(4) 비트 → **왕**
- `type` 비트 2 = 슬라이더 = 드럼롤. 길이 = `pixelLength × repeats / (SliderMultiplier × 100 × SV) × beatLength`
- `type` 비트 8 = 스피너 = 덴덴. `objectParams` 의 endTime
- 타이밍 포인트: uninherited(beatLength > 0) 는 BPM/박자 → 마디선. inherited(음수) 는 SV → 드럼롤 길이 계산에만 사용
- **모든 `t` 는 정수 ms.** 정렬·필드 순서 고정. 같은 `.osu` 면 바이트까지 같은 JSON

### `chart.json` 스키마
```ts
interface Chart {
  version: 1;
  meta: { title: string; artist: string; difficulty: string; bpm: [min, max]; od: number; hp: number };
  timing: { t: number; beatLength: number; meter: number }[];   // uninherited 만
  notes: { t: number; k: 'd' | 'k'; big: boolean }[];
  rolls: { t: number; end: number; big: boolean }[];
  spinners: { t: number; end: number; hits: number }[];
  hash: string;   // meta 제외, notes/rolls/spinners/timing 의 sha256
}
```
- `hash` 가 기록·리플레이의 키. `songId` 단위로 쌓으면 변환기 개선 시 과거 기록이 오염됨

### 곡 폴더
```
songs-src/<id>/             원본 (WAV 는 git 에 넣지 않음)
  easy.osu | normal.osu | hard.osu   난이도별 채보, 있는 것만
  song.wav, jacket.png, song.json    { title, artist, audioOffset }

public/songs/<id>/
  chart.<tier>.json         tier = easy | normal | hard
  audio.<hash>.webm
  jacket.<hash>.avif        1024px 정사각
  jacket-sm.<hash>.avif     256px (결과 화면 등 128px 이하 자리; 캐러셀·플레이 HUD 는 1024 원본을 쓴다)
  meta.json                 { id, title, artist, palette, audioOffset, durationMs, charts: [{ tier, name, file, hash, od, bpm, notes, level }] }
public/songs/index.json     빌드 시 생성
```
- 난이도는 **easy / normal / hard** 세 단계. 파일명이 단계를 정하고, `.osu` 의 `Version` 은 보조 이름
- `level` 1~10 은 빌드 시 노트 밀도와 OD 에서 결정적으로 계산 (`src/app/types.ts` 참고)
- 파일명 콘텐츠 해시 + `Cache-Control: immutable`
- `palette` 는 빌드 시 자켓에서 추출 (런타임 추출 금지, 결정적이고 빠름)

---

## 5. 오디오

### 포맷
- **webm (Opus 128k VBR) 단일.** Safari 는 iOS 18.4 / macOS 15.4 부터 WebM Opus 를 `<audio>` 와 Web Audio 양쪽에서 지원. 그 이하 iOS(15.4~18.3)는 불안정하므로 지원 범위 밖
- 전체 곡을 `decodeAudioData` 로 AudioBuffer 에 올려 `AudioBufferSourceNode` 로 재생. 컨테이너 스트리밍 특성은 무관
- 디코드된 PCM ≈ 분당 10MB. 10분 이상 곡은 피한다
- MP3 는 인코더 딜레이 처리가 브라우저마다 달라 오프셋이 흔들리므로 쓰지 않음

### 인코딩
```bash
ffmpeg -i song.wav -c:a libopus -b:a 128k -vbr on -application audio audio.webm
```
- Mapperatorinator 에 넣은 WAV 와 **같은 파일**에서 인코딩한다
- Opus pre-skip 은 규격 고정이라 브라우저 간 오프셋 편차 없음. 파이프라인 확정 시 한 번만 개발 페이지에서 디코드 결과를 WAV 와 상호상관으로 비교해 `audioOffset` 을 검증 (0 이어야 함)

### 프로브
- 앱 시작 시 1초짜리 `probe.webm` 을 `decodeAudioData` 로 디코드. 실패하면 "브라우저를 업데이트해 주세요" 안내
- `canPlayType` 은 믿지 않는다 (Safari 15 에서 `<audio>` 와 Web Audio 지원이 달랐던 전례)
- 로더는 포맷 목록을 순서대로 시도하는 구조로 짜서, 나중에 m4a 폴백이 필요해지면 파일 하나 추가로 끝나게

### SoundCloud iframe 은 불가
Widget API 는 폴링 기반이라 수백 ms 지터, Web Audio 접근 불가, 모바일 자동재생 제한, 프리로드 불가. 곡 선택 미리듣기 용도 이상은 안 됨.

---

## 6. 이미지

- **AVIF 단일.** Chrome 85 / Firefox 93 / iOS 16 / macOS Safari 16.4(Ventura 13.3+) / Edge 121. 오디오 요구 범위(iOS 18.4+)보다 넓음
- 래스터는 자켓과 배경뿐. 노트·게이트·UI 는 Pixi Graphics 로 그려 이미지 의존 제거
- 변환: sharp `avif({ quality: 50, effort: 6 })`. 빌드 스크립트에서 캐시 (인코딩 느림)
- 폴백 필요 시 Pixi Assets 의 `{ src: ['a.avif', 'a.webp'] }` 로 파일 하나 추가. 지금은 안 넣음

---

## 7. 타이밍 엔진

### 시계
```ts
// 시작: 즉시 start 하지 않고 살짝 뒤 시각을 예약해 시작 지터 제거
const startAt = ctx.currentTime + 0.1;
source.start(startAt);

// 매 프레임 (렌더용)
const songMs = (ctx.currentTime - startAt) * 1000 - audioOffset;

// 입력: 이벤트 timeStamp(performance 기준) → 오디오 시계
const { contextTime, performanceTime } = ctx.getOutputTimestamp();
const hitMs = (contextTime + (e.timeStamp - performanceTime) / 1000 - startAt) * 1000 - inputOffset;
```

### 원칙
- **판정은 `AudioContext.currentTime` 기준, 렌더는 rAF.** 섞지 않는다
- **입력은 이벤트가 오는 순간 즉시 판정.** `event.timeStamp` 를 위처럼 환산. rAF 에서 읽으면 최대 16ms 오차
- **Miss 만 프레임 루프**에서 확정
- `<audio>` 요소의 `currentTime` 은 절대 안 씀 (갱신 주기 수십~수백 ms)
- 일시정지는 `ctx.suspend()/resume()`. currentTime 이 같이 멈춰 오프셋 재계산 불필요
- `getOutputTimestamp` 미지원 브라우저용 폴백: 매 프레임 `(performance.now(), ctx.currentTime)` 쌍을 갱신해 사용
- 히트음은 짧은 AudioBuffer 를 그때그때 `start()`. 지연 1ms 미만

### 보정
- 블루투스 이어폰의 100~200ms 지연은 시계로 못 잡는다. `ctx.outputLatency` 는 힌트일 뿐
- 보정 화면(메트로놈 탭)에서 오프셋 두 개를 잡아 localStorage 에 저장:
  - `audioOffset`: 화면 대비 오디오
  - `inputOffset`: 입력

### core 패키지
- Pixi 를 import 하지 않는 순수 TS. 진입점은 `tick(songMs)` 와 `hit(key, hitMs)` 둘
- 입력 로그 `[t, key][]` 를 항상 기록. 점수 = f(chartHash, offsets, inputLog) 로 재계산 가능
- 같은 코드로 단위 테스트(로그 재생) 와 나중의 서버 리플레이 검증

---

## 8. 아키텍처

```
src/core/      clock, judge, chart 타입, replay, score     ← 프레임워크 무관, 순수 TS, 단위테스트
src/input/     keyboard, pointer(touch), gamepad → 통일된 { t, key } 이벤트
src/render/    트랙 렌더러 (로컬 좌표) + portrait / landscape 레이아웃 (PixiJS)
src/audio/     로더(프로브, 포맷 목록), 플레이어, 히트음
src/ui/        Svelte: 곡 선택, 플레이 셸, 결과, 설정, 보정
src/backend/   interface Backend { submitScore, getScores, ... }  → LocalBackend (localStorage)
tools/         convert-osu.ts, encode-audio.sh, encode-jacket.ts, build-index.ts
public/songs/  §4 곡 폴더
```

- 모드 전환(세로/가로)은 `matchMedia('(orientation: portrait)')` + 입력 장치 감지. 플레이 중에는 고정
- 상태: 곡 선택/설정은 Svelte store, 플레이 중 핫패스는 core 의 plain object (GC 회피, 노트 풀링)

---

## 9. 화면 흐름

1. 부팅 (오디오 언락 + 프로브) → 바로 곡 선택
2. 곡 선택 (캐러셀, EASY/NORMAL/HARD, 최고 기록)
3. 플레이 (세로/가로 자동)
4. 결과 (판정 분포, 정확도, 콤보, 리플레이 저장)
5. 설정 (키 배치, 하이스피드, 오프셋 숫자 입력, **오프셋 보정 화면 진입**). 보정은 여기서만 연다. 첫 실행에 강제로 띄우지 않는다

---

## 10. 마일스톤

1. **파이프라인**: convert-osu.ts + 곡 1개 (chart.json / audio.webm / jacket.avif). 결정성 테스트 (같은 입력 → 같은 바이트)
2. **core 엔진**: clock, judge, score, replay. headless 로 입력 로그 재생 테스트
3. **세로 렌더 + 터치**: 트랙, 게이트, 판정 이펙트, 2×2 터치존
4. **가로 렌더 + 키보드**: 같은 렌더러 회전, 키 바인딩
5. **UI 셸**: 곡 선택, 결과, 설정, 보정
6. **게임패드, 폴리시, 배포**: 프로브, 전체화면, 캐시 헤더, PWA 검토
7. **Supabase** (사람이 모이면): §12

---

## 11. 자산 생성

- 음원: AI 생성 (라이선스 조건 확인 후 저장소 동봉). 한정 수량
- 채보: Mapperatorinator → osu!taiko. 곡마다 easy / normal / hard 를 각각 생성해 `songs-src/<id>/<tier>.osu` 로 둔다 (osu 의 Kantan/Futsuu/Muzukashii/Oni 는 쓰지 않음)
- 자켓: AI 생성 1024px 정사각 → AVIF

---

## 12. 백엔드 (나중)

지금은 붙이지 않는다. 진짜 리스크는 읽기 쉬운 트랙과 오디오 보정이고, 랭킹은 사람이 있어야 의미가 있다.
붙일 때 비용이 0 에 가깝도록 지금 지키는 규칙:

- `backend/` 인터페이스 뒤에 LocalBackend. UI 는 인터페이스만 본다
- 기록은 `chartHash` 단위, 리플레이(입력 로그) 항상 저장
- 점수는 (chartHash, offsets, inputLog) 만으로 재계산 가능하게 유지

붙일 때:
- Supabase OAuth PKCE (정적 사이트에서 동작)
- `scores(user_id, song_id, chart_hash, score, acc, max_combo, replay jsonb, created_at)` + RLS (insert 본인, select 전체)
- 필요 시 Edge Function 에서 리플레이 재계산으로 검증

---

## 13. 절대 깨면 안 되는 것

- 판정은 `AudioContext.currentTime`, 렌더는 rAF. 섞지 않는다
- 입력 타임스탬프는 `event.timeStamp` 를 환산해서 쓴다. rAF 에서 읽지 않는다
- 채보 `t` 는 정수 ms. 변환은 결정적
- 기록·리플레이는 `chartHash` 단위
- 트랙 폭 = 손, 타입 = 모양/색. 레인을 타입으로 나누지 않는다
- 일반 노트를 특정 손 레인에 그리지 않는다 (손은 자유)
- core 는 Pixi 를 import 하지 않는다

---

## 14. 미확정

- 터치존 기본 배치: KK/DD 로 확정. 대안(안/밖) 을 설정에 둘지
- 호스팅: GitHub Pages / Vercel / Cloudflare Pages
- PWA 여부 (호스팅이 Cache-Control 을 못 다루면 필요)
- 실제 계정 확인 (frontishobby 가정)
