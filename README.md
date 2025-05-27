Локальный запуск
1. установить docker (https://www.docker.com/products/docker-desktop/)
1.1 в случае использования windows необходимо вначале установить wsl (windows subsystem for linux) - в powershell 
```wsl --install```
и создать базового пользователя linux (без этого docker не установится)

2. после этого склонировать проект
   2.1 выполнить в корне проекта docker compose up, это запустит все backend сервисы
   2.2 установить nodejs (https://nodejs.org/en)
   2.3 после перейти в папку client (cd ./client)
   2.4 прописать в терминале ```npm install --legacy-peer-deps``` (это установит все зависимости)
   2.5 выполнить команду ```npm start```
   2.6 открыть ```http://localhost:4200``` в браузере 

