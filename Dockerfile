FROM ubuntu:22.04
COPY . ./
RUN apt-get update
RUN apt-get install -y curl
# NOTE 'g++ unzip zip' are required by bazel
RUN apt-get install -y g++ unzip zip git
RUN curl -Lo /usr/local/bin/bazelisk https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64 && \
    chmod +x /usr/local/bin/bazelisk
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g npm@latest
RUN npm install
RUN npm run compile
RUN curl https://raw.githubusercontent.com/lacework/go-sdk/main/cli/install.sh | bash

RUN groupadd -r user && useradd -r -g user user
USER user

ENTRYPOINT ["/docker-entrypoint.sh"]
