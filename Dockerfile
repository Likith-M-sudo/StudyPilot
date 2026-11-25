# Serves the static StudyPilot app on Google Cloud Run.
# Cloud Run sets $PORT (8080); the nginx image fills it into the config template at start-up.
FROM nginx:1.27-alpine

ENV PORT=8080

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY index.html styles.css /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/

EXPOSE 8080
