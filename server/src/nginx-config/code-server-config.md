events {

# Here are the events

}

http {
server {
listen 80;
server*name *;

          location /assets/ {

                root /var/www/html;

        }

            location / {
                # Disable gzip so sub_filter works
                proxy_set_header Accept-Encoding "";

                # WebSocket support
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;

                # Proxy to code-server
                proxy_pass http://127.0.0.1:8080/;


                add_header X-Debug-Injected "yes";

                # Inject heartbeat script into all HTML responses
                proxy_buffering on;
                sub_filter_types text/html;
                sub_filter_once off;
                sub_filter '<head>' '<head><script defer src="/assets/heartbeat.js?v=1"></script>';
            }
        }

}
