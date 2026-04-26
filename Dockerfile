FROM sqlpage/sqlpage:latest
WORKDIR /app
COPY calory.db .
RUN mkdir -p sqlpage
COPY sqlpage/*.sqlpage sqlpage/
EXPOSE 8080
CMD ["--database-url", "sqlite://./calory.db", "--directory", "/app/sqlpage"]
