import './global.css';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as SockJS from 'sockjs-client';

import { LoginForm } from './components/LoginForm';

function render() {
    ReactDOM.render(
        <div>
            <h1>Acquire</h1>
            <h2>Login</h2>
            <LoginForm onSubmit={onSubmitLoginForm} />
        </div>,
        document.getElementById('root'),
    );
}

function onSubmitLoginForm(username: string, password: string) {
    connect(username, password);
}

function connect(username: string, password: string) {
    const sock = new SockJS('http://localhost:9999/sockjs');

    sock.onopen = function(e) {
        sock.send(JSON.stringify([0, username, password, []]));
    };

    sock.onmessage = function(e) {
        console.log(JSON.parse(e.data));
        sock.close();
    };

    sock.onclose = function(e) {};
}

render();