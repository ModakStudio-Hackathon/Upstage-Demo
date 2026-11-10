# 모닥 장부 프론트엔드

React와 Vite로 만든 영수증 장부 화면입니다. 브라우저에서 Upstage API 키를 사용하지 않고, 백엔드를 통해 영수증 분석과 장부 CRUD를 호출합니다.

## 로컬 실행

1. 백엔드를 `http://127.0.0.1:8000`에서 실행합니다.
2. 이 폴더에서 환경 파일을 만들고 프론트를 실행합니다.

```sh
cp .env.example .env
npm install
npm run dev
```

Vite 개발 서버는 `/api` 요청을 백엔드로 전달합니다. 백엔드 주소가 다르면 `.env`의 `VITE_API_PROXY_TARGET` 값을 변경하세요.

## 연결 API

- `GET /receipts`: 장부 목록을 불러옵니다.
- `POST /receipts/analyze`: multipart의 `file` 필드로 한 장의 이미지를 보내고 AI 분석 JSON을 받습니다. 화면에서 여러 장을 고르면 프론트엔드가 연락처 시트 형태의 합본 이미지 하나를 만들어 한 번만 요청합니다.
- `POST /receipts`: 확인한 분석 초안을 장부에 저장합니다.
- `PATCH /receipts/{receipt_id}`: 검토 항목을 승인합니다.

분석 결과는 저장 전에 화면에서 수정할 수 있습니다. AI가 한 사진에서 여러 영수증을 각각 추출하려면 에이전트 지침에서 결과를 영수증별 JSON 배열로 반환하도록 설정하세요. 배포 환경에서 백엔드에 직접 연결할 때는 `VITE_API_BASE_URL`을 백엔드 URL로 지정하고, 백엔드 CORS에서 프론트엔드 origin을 허용해야 합니다.
