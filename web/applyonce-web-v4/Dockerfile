# Node + Python이 같이 필요한 서버 (pdf_fill 폴더가 python 스크립트를 spawn으로 실행함)
FROM node:20-slim

# Python 및 필요한 시스템 폰트 라이브러리 설치
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node 의존성 설치
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Python 의존성 설치 (가상환경 없이 시스템 파이썬에 바로 설치)
COPY pdf_fill/requirements.txt ./pdf_fill/requirements.txt
RUN pip3 install --break-system-packages -r pdf_fill/requirements.txt

# 나머지 소스 복사
COPY . .

ENV PYTHON_BIN=python3

# Render/Railway 등은 PORT 환경변수를 자동으로 주입함 (server.js가 이미 처리)
EXPOSE 3000

CMD ["node", "server.js"]
