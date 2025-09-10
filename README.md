
## 사전조건

### docker

docker 이미지를 통해 mongoDB를 실행합니다.

```bash
docker run -d \
  --name demo-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=example \
  -v mongo_data:/data/db \
  --restart unless-stopped \
  mongo:6
```

### Package

데모에 필요한 패키지를 설치합니다.

```bash
npm i mongodb bcryptjs jsonwebtoken
npm i -D @types/bcryptjs @types/jsonwebtoken
```

다음으로 환경변수를 적용하기위해 .env.local 파일을 생성합니다.

```bash
MONGODB_URI=mongodb://root:example@localhost:27017
MONGODB_DB=app
JWT_SECRET=change-this

```

JWT_SECRET 값에는 임의의 값을 넣어줍니다.
예를 들어 `openssl rand -base64 32` 명령어를 통해 난수를 생성하여 입력해줍니다.

## 서버 실행

서버를 실행합니다.

```bash
npm run dev
# or
yarn dev
```
