#!/bin/bash
cd aolkijai2 
docker run -i --rm --name aoldev2 -v "$(pwd)":/code -w /code aol2-dev-image yarn
