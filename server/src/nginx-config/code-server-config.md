events {
worker_connections 1024;
}

http {

    server {
        listen 80 default_server;
        server_name _;

        access_log /var/log/nginx/access.log;
        error_log  /var/log/nginx/error.log notice;

        location /assets/ {
            root /var/www/html;
        }

        location /heartbeat {
            proxy_pass https://multi-coder-server.codeclause.tech/ping;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            proxy_pass http://127.0.0.1:8080/;

            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;

            proxy_set_header Accept-Encoding "";
            sub_filter_once off;
            sub_filter_types text/html;
            sub_filter '</head>' '<script src="/assets/config.js"></script><script defer src="/assets/heartbeat.js?v=1"></script></head>';
        }
    }

}
