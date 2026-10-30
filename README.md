# 카페 온기: 내 도메인에 올리기

함께 앉아 작업하는 3D 가상 카페입니다. 같은 주소로 들어온 사람들은 서로의 캐릭터, 자리 이동, 커피 마시는 동작, 채팅을 실시간으로 봅니다.

## 폴더 구성

| 파일 | 역할 |
|---|---|
| `server.js` | 페이지 제공과 실시간 중계(웹소켓)를 함께 하는 Node.js 서버 |
| `public/index.html` | 카페 화면 전체(3D, 소리, 채팅) |
| `package.json` | 실행 설정. 필요한 라이브러리는 `ws` 하나 |

일반 웹호스팅(파일만 올리는 PHP 호스팅 등)에서는 실시간 기능이 동작하지 않습니다. **Node.js 서버를 실행할 수 있는 곳**이 필요합니다.

## 1. 내 컴퓨터에서 먼저 시험하기

1. Node.js 18 이상을 설치합니다.
2. 이 폴더에서 터미널을 열고 다음을 실행합니다.
   ```
   npm install
   npm start
   ```
3. 브라우저에서 `http://localhost:3000` 을 엽니다. 새 탭으로 하나 더 열면 손님이 두 명이 되고, 채팅이 서로 보입니다.

## 2. Vercel + Render로 올리기 (권장 구성)

Vercel은 화면과 도메인을 맡고, 실시간 서버는 Render에 둡니다. Vercel 함수에 이 서버를 그대로 올리면 접속이 일정 시간 뒤 끊기고, 접속자가 서로 다른 서버에 나뉘어 붙어 서로가 안 보일 수 있기 때문입니다.

```
방문자 ──(화면)────> Vercel   cafe.mydomain.com        public 폴더
      └─(실시간)──> Render   cafe-ongi.onrender.com   server.js
```

### 2-1. GitHub에 올리기
1. github.com 에서 새 저장소(예: `cafe-ongi`)를 만듭니다.
2. 이 폴더 전체를 올립니다. 웹 화면의 "Add file → Upload files"로 끌어다 놓아도 됩니다. `node_modules` 폴더는 올리지 않습니다.

### 2-2. Render에 실시간 서버 올리기
1. render.com → New → Web Service → 저장소 선택
2. Runtime: Node / Build Command: `npm install` / Start Command: `npm start` / Instance Type: Free
3. Environment에 값 두 개를 넣습니다.
   - `HOST_KEY`: 네온 사인을 바꿀 때 쓸 비밀 문구(남이 추측하기 어려운 영문과 숫자)
   - `ALLOWED_ORIGINS`: 처음에는 비워 두고, 도메인을 연결한 뒤 `https://cafe.mydomain.com,https://(프로젝트).vercel.app` 처럼 채웁니다.
4. 배포가 끝나면 생긴 주소(예: `https://cafe-ongi.onrender.com`)를 적어 둡니다.

### 2-3. 화면이 실시간 서버를 찾도록 설정
GitHub에서 `public/config.js` 를 열어 한 줄만 고치고 저장(Commit)합니다. 주소 앞의 `https` 를 `wss` 로 바꾸고 끝에 `/ws` 를 붙입니다.
```
window.CAFE_WS = "wss://cafe-ongi.onrender.com/ws";
```

### 2-4. Vercel에 화면 올리기
1. vercel.com → Add New → Project → GitHub 저장소 Import
2. **Root Directory를 `public` 으로 지정**합니다. Framework Preset은 `Other`, Build Command는 비워 둡니다.
3. Deploy를 누르면 `https://(프로젝트).vercel.app` 주소가 생깁니다. 탭 두 개로 열어 서로 보이면 성공입니다.

이후에는 GitHub에 파일을 고쳐 올릴 때마다 Vercel과 Render가 자동으로 다시 배포합니다.

## 3. 내 도메인 연결하기

1. Vercel 프로젝트 → Settings → Domains에서 도메인(예: `cafe.mydomain.com`)을 추가합니다. 도메인이 없으면 같은 화면에서 구매할 수도 있습니다.
2. 다른 곳(가비아, 후이즈, Cloudflare 등)에서 산 도메인이라면, Vercel 화면에 표시되는 DNS 값을 구입처 DNS 설정에 그대로 입력합니다. 하위 도메인은 보통 CNAME, 루트 도메인은 A 레코드입니다.
3. 연결되면 HTTPS가 자동으로 적용됩니다.
4. Render의 `ALLOWED_ORIGINS` 에 새 도메인 주소를 추가합니다. 다른 사이트가 이 서버를 몰래 쓰지 못하게 막는 설정입니다.

### 네온 사인 바꾸기
주인은 `https://cafe.mydomain.com/?host=(HOST_KEY 값)` 으로 접속합니다. 채팅 옆에 '네온에 띄우기' 버튼이 보입니다. 이 주소는 다른 사람에게 알려 주지 마세요.

### Render 무료 요금제 참고
15분 동안 아무도 없으면 서버가 잠들고, 다음 방문자가 들어올 때 깨어나는 데 1분 정도 걸립니다. 그동안 화면에는 '카페에 들어가는 중'이 보이다가 자동으로 연결됩니다. 상시 운영하려면 유료 인스턴스로 바꾸세요.

### Render 하나로만 운영하고 싶다면
Vercel 없이 Render 주소에 도메인을 바로 연결해도 됩니다(Render → Settings → Custom Domains). 이때는 `config.js` 를 비워 둡니다.

## 4. 운영 팁

- **카페를 여러 개로 나누기**: 주소 뒤에 `?room=study` 처럼 붙이면 서로 분리된 카페가 됩니다.
- **인원 제한**: 한 카페 최대 60명입니다(`server.js` 의 `MAX_PER_ROOM`). 좌석은 24개라 그 이상은 자리가 겹칩니다.
- **채팅 기록**: 서버 메모리에 최근 40개만 보관합니다. 서버가 다시 시작되면 사라집니다.
- **속도 제한**: 한 사람이 채팅을 1.4초에 1번 정도만 보낼 수 있고, 120자를 넘으면 잘립니다.
- **공개 전 확인할 것**: 누구나 들어올 수 있으므로 욕설 필터, 신고와 차단 기능, 개인정보 처리 안내가 필요할 수 있습니다. 현재 버전에는 들어 있지 않습니다.

## 화면을 고친 뒤 다시 만들기

Claude에서 다듬은 `cafe-ongi.html` 을 이 폴더 바로 위에 두고 `python3 build.py` 를 실행하면 `public/index.html` 이 새로 만들어집니다.
