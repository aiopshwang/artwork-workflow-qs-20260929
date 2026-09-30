# 아트워크 BPMN 편집기

프로젝트 원본과 분리한 독립 편집기. 외부 `editor/` 안에서만 생성했다.

## 열기

- `dist/index.html`을 Chrome·Edge·Safari에서 연다. 모든 JS·CSS·아이콘 글꼴이 로컬 번들에 포함되어 CDN이나 서버가 필요하지 않다.
- 호스팅할 때는 `dist/` 전체를 정적 사이트에 올린다.
- 공유·검토의 정본은 사용자가 내려받은 `.bpmn` 파일이다. 임시 보관본은 같은 기기의 같은 브라우저에만 남는다. 여러 사람이 동시에 편집하는 서버 기능은 없다.

## 사용

- 파일 열기 / BPMN 저장 / 현재 계층 SVG 저장
- 도형 드래그, 연결선 추가·수정, 이름 직접 편집, 실행취소·다시실행
- 접힌 하위 프로세스의 드릴다운 버튼 → 상세 흐름 → 상위 복귀
- 상단 계층 선택으로 전체·하위 흐름 이동
- 상세 계층은 100% 읽기 크기로 시작하며 전체 맞춤으로 현재 계층을 한눈에 확인
- 우하단 현재 계층 미니맵: 파란 사각형이 현재 위치. 클릭·드래그로 이동, 접기 가능(PC 표시, 새 의존성 없음)
- 도형 선택 → 오른쪽 이름·업무 설명·규칙 번호 편집
- 설명을 입력한 뒤 단계 반영, 다른 단계 선택, 또는 BPMN 저장 시 값이 모델에 적용됨
- 새 초안이 열려도 저장된 임시 보관본은 자동으로 덮지 않음. `임시 보관본 열기`로 회복
- 휴대폰에서는 열람·설명 수정·파일 저장을 지원. 도형·연결선을 정교하게 편집할 때는 PC 마우스 권장

## 빌드

```sh
npm ci
npm run build
```

`workflow.bpmn`을 editor 루트에 두고 빌드하면 그 XML이 초기 모델로 번들된다. 없으면 내용이 비어 있는 BPMN 문서를 넣는다. 임의 아트워크 업무 시나리오는 생성하지 않았다.

## 데이터 보존 계약

- 모든 상위·하위 프로세스, 연결, 레인, 좌표를 하나의 BPMN 2.0 XML로 가져오고 내보낸다.
- 설명은 표준 `bpmn:documentation`. 첫 번째 일반 설명을 편집하고 나머지는 유지한다.
- 규칙 번호는 `bpmn:documentation textFormat="application/vnd.artwork.rule-ids"`에 JSON 문자열 배열로 저장한다. UI에서는 쉼표로 구분한다.
- 역할·상태·범위 보조정보는 `application/vnd.artwork.metadata+json` documentation을 읽기 표시하고 원본 보존한다. 레인 이동 후 보조정보에 기재된 초안 역할과 실제 레인이 달라질 수 있으므로 검토 시 실제 레인을 확인한다.
- XML은 bpmn-js 직렬화로 재정렬·정규화된다. 바이트 단위 원문 보존을 뜻하지 않는다. 지원하지 않는 외부 확장 XML은 import 경고를 확인해야 한다.
- 잘못된 파일을 열어 import에 실패하면 기존 모델 XML을 복원한다.

## 버전 / 의존성

- bpmn-js 18.30.1 (npm 조회 후 exact pin)
- esbuild 0.28.2 / Playwright 1.63.0 (빌드·검증 전용)
- `package-lock.json` 포함. 실행 번들은 npm·Node·인터넷 없이 동작.
- BPMN.io 표시와 라이선스를 유지한다.

## 검증

실제 설치 Chrome의 headless Chromium으로 file:// 번들을 실행했다.

```sh
npm test
node tests/mcp-roundtrip.mjs
```

`verification/RESULT.json`, `verification/MCP-RESULT.json`, `verification/domain/RESULT.json`, `verification/domain/UI-RESULT.json`에 결과가 있다. 실제 업무 모델 58계층 탐색·파일 왕복, PC 1440×1000 및 모바일 390×844 저장 버튼 가시성·실제 다운로드, 시작노드 가시성, 미니맵 클릭 이동도 확인했다. 기술 전용 fixture로 이름·설명·규칙 편집, undo/redo, 접힌 subprocess 진입·상위 복귀, 하위 단계 이동, XML 다운로드·재import, 임시저장, 미저장 교체 취소, 역할 레인과 metadata 보존을 확인했다. 기술 fixture는 실제 아트워크 업무 사례가 아니며 초기 화면에 쓰지 않는다.

## 공식 근거

- https://bpmn.io/toolkit/bpmn-js/
- https://bpmn.io/toolkit/bpmn-js/walkthrough/
- https://github.com/bpmn-io/bpmn-js

이 편집기는 BPMN 작성 도구이며 업무를 실행하는 워크플로 엔진이 아니다. MCP 연결은 별도 도구 층에서 수행하고 결과 표준 XML을 이 편집기로 전달한다.
