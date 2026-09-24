# DYAD — 작업 규칙

## 계정 (엄수)

이 저장소는 **frontishobby 계정 전용**이다. `david02324`를 절대 쓰지 않는다.
첫 커밋 전에 로컬 git identity를 고정한다:

```
git config user.name  frontishobby
git config user.email 92085928+frontishobby@users.noreply.github.com
```

푸시는 `gh auth switch --user frontishobby` 후에 한다.

## 커밋

**AI author / Co-Authored-By 트레일러를 넣지 않는다.** `Generated with Claude Code` 류도 금지.

## 고정 제약

- **Vite + Svelte 5 + TypeScript.** UI 셸은 Svelte, 게임 캔버스는 PixiJS v8. Phaser 등 게임 엔진 금지
- **음원은 webm(Opus) 단일, 이미지는 AVIF 단일.** 폴백 파일을 추가하지 않는다 (필요해지면 PLAN.md §5, §6)
- **백엔드 없음.** `backend/` 인터페이스 뒤에 LocalBackend 만. 붙일 때는 PLAN.md §12
- **논리 해상도** 가로 1280×720, 세로 720×1280. 비율 유지 스케일 + 레터박스, 업스케일 금지

## 절대 깨면 안 되는 것

- **판정은 `AudioContext.currentTime` 기준, 렌더는 rAF.** 둘을 섞지 않는다
- **입력 타임스탬프는 `event.timeStamp`를 `getOutputTimestamp`로 환산해서 즉시 판정한다.** rAF에서 읽으면 최대 16ms 오차
- **채보 노트의 `t`는 정수 ms.** 변환은 결정적 (같은 `.osu` → 같은 바이트)
- **기록·리플레이는 `chartHash` 단위.** `songId` 단위로 쌓지 않는다
- **트랙 폭 = 손, 타입 = 모양/색.** 레인을 돈/캇으로 나누면 왕노트가 "돈+캇"으로 읽힌다
- **일반 노트는 중앙에 하나.** 특정 손 레인에 그리지 않는다 (손은 자유)
- **`src/core/`는 Pixi를 import하지 않는다.** 진입점은 `tick(songMs)`, `hit(key, hitMs)`

자세한 근거는 PLAN.md.
