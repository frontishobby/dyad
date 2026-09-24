# colab/

DYAD 채보 생성용 Colab 노트북. 음원 하나 → Mapperatorinator(V32, osu!taiko) → `songs-src/<id>/` 묶음.

| 파일 | 역할 |
| --- | --- |
| `dyad_taiko_generate.ipynb` | EASY / NORMAL / HARD 세 채보 생성 + `song.wav` / `song.json` 묶음 (`dyad-<id>.zip`). 자켓은 로컬에서 넣는다 |

브라우저에서 열기: https://colab.research.google.com/github/frontishobby/dyad/blob/main/colab/dyad_taiko_generate.ipynb
(공개 저장소라 따로 배포할 것 없이 이 링크가 곧 배포다. `main` 에 푸시하면 링크가 바로 새 버전을 연다.) 런타임은 GPU(T4 이상).

## 결과물 쓰는 법

```
unzip dyad-<id>.zip -d songs-src/
cp cover.webp songs-src/<id>/jacket.webp   # png / jpg / webp / avif 아무거나
npm run songs:build                        # → public/songs/<id>/
```

## CLI 로 돌리기 (`google-colab-cli`)

폼 값 대신 환경변수 `DYAD_*` 를 읽으므로 브라우저 없이 돌릴 수 있습니다.

```sh
colab new -s dyad --gpu T4
colab upload -s dyad "Artist - Title.mp3" /content/dyad-in/song.mp3

# 같은 커널에 환경변수를 심고 노트북을 실행
cat <<'PY' | colab exec -s dyad
import os
os.environ.update({
    "DYAD_ACCEPT_RULES": "1",
    "DYAD_AUDIO": "/content/dyad-in/song.mp3",
    "DYAD_TITLE": "Title",
    "DYAD_ARTIST": "Artist",
    "DYAD_SONG_ID": "title",
    "DYAD_HARD": "4.6", "DYAD_NORMAL": "3.2", "DYAD_EASY": "2.0",
    "DYAD_SEED": "12345",
    "DYAD_NO_DOWNLOAD": "1",
})
PY
colab exec -s dyad -f colab/dyad_taiko_generate.ipynb --timeout 3600

colab download -s dyad /content/dyad-out/dyad-title.zip ./
colab stop -s dyad
```

환경변수 목록: `DYAD_ACCEPT_RULES` `DYAD_AUDIO` `DYAD_JACKET` `DYAD_SONG_ID` `DYAD_TITLE` `DYAD_ARTIST`
`DYAD_EASY` `DYAD_NORMAL` `DYAD_HARD` (스타 레이팅) `DYAD_MODEL` `DYAD_YEAR` `DYAD_SEED` `DYAD_TEMPERATURE` `DYAD_CFG`
`DYAD_DESCRIPTORS` (쉼표 구분) `DYAD_SUPER_TIMING` `DYAD_TIERS` (예: `easy`, 하나만 다시 뽑을 때) `DYAD_NO_DOWNLOAD`.

## 생성 방식

1. HARD → NORMAL → EASY 순서로 각각 생성한다 (타이밍 + 노트 + SV). V32 의 taiko 전용 체크포인트는 `in=[] → out=[TIMING, MAP, SV]` 템플릿 하나만 지원해서 `in_context` 로 타이밍을 넘길 수 없다. 같은 시드와 같은 음원이라 타이밍은 실질적으로 같게 나온다.
2. 헤더만 손본다: `AudioFilename: song.wav`, `Version`, `Title`, `Artist`. 히트오브젝트·타이밍 포인트는 모델 출력 그대로 (변환기 `tools/convert-osu.ts` 가 결정적으로 처리).
3. 원본 음원을 44.1 kHz 16-bit `song.wav` 로 옮긴다. 자켓은 모델과 무관하므로 로컬에서 넣는다 (`DYAD_JACKET` 을 주면 그대로 같이 묶어 주기는 한다).
4. GPU 가 bf16 을 못 쓰면(T4) fp16 으로 돌린다.

같은 시드 + 같은 설정이면 같은 채보가 나온다. 시드는 셀 3 출력에 찍힌다.

## 다음 단계

음원만 넣으면 `chart.<tier>.json` + `audio.<hash>.webm` + AVIF 까지 Colab 안에서 뽑는 노트북 (Node + `tools/build-songs.ts` 를 VM 에서 실행).
