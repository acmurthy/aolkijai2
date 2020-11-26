docker run -i --rm --name aol-server -p 127.0.0.1:9999:9999 -v "$(pwd)":/code -w /code aol2-dev-image bash
yarn server
docker run -i --rm --name aol-client -p 127.0.0.1:8080:8080 -v "$(pwd)":/code -w /code aol2-dev-image bash
yarn client
