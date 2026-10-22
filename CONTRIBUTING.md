# Como contribuir

Obrigado por querer ajudar. Este guia é curto de propósito.

## Requisitos

- [Node.js](https://nodejs.org) 22.9 ou mais novo.
- [ffmpeg](https://ffmpeg.org), só para gerar a biblioteca de exemplo e converter vídeos.

## Instalar e rodar

```sh
npm install
npm run dev                  # app em http://localhost:5173
npm run cli -- ajuda         # lista os comandos da linha de comando
npm run exemplo              # vídeos de teste em exemplo/biblioteca (precisa do ffmpeg)
npm run exemplo:real         # desenhos em domínio público em exemplo/dominio-publico/biblioteca (~830 MB)
```

`npm run exemplo` gera vídeos de teste com o ffmpeg. `npm run exemplo:real` baixa desenhos em domínio público do Internet Archive. Os dois escrevem em `exemplo/`, que o git ignora.

## Antes de abrir um pull request

```sh
npm run typecheck
npm test
npm run build
```

O CI roda esses três comandos em todo pull request ([ci.yml](.github/workflows/ci.yml)). Se algum falhar na sua máquina, vai falhar lá também.

## Regras do projeto

- **Nunca suba vídeos protegidos.** Nada de episódios, vinhetas, comerciais ou qualquer vídeo com direitos autorais. `biblioteca/`, `exemplo/` e `pacote/` ficam no `.gitignore`. A única mídia no git são os clipes em domínio público de `site/videos/`, com os créditos em [site/videos/CREDITOS.txt](site/videos/CREDITOS.txt).
- **Nunca suba o `.env` nem a `TYPESAFE_API_KEY`.** A chave só é necessária para `tv-gominho organizar` e `npm run avaliar:jev`. Sem ela, o resto funciona.
- **Nomes do projeto dizem "TV Gominho".** "TV Globinho" aparece só quando se fala do programa real da época.
- O projeto é GPL-3.0. Ao contribuir, você concorda que seu código siga a mesma licença.

## Issues

Abra uma [issue](https://github.com/matheusgomes062/tv-gominho/issues/new/choose) usando um dos modelos: **bug** ou **sugestão**. Elas entram com o rótulo `needs-triage` até alguém olhar. Antes de começar algo grande, comente na issue para combinarmos o caminho.

## Código e commits

- Siga o estilo do código ao redor. Não reformate arquivos que você não mexeu.
- Mensagens de commit em inglês, no imperativo, com a primeira linha curta. Exemplos: `Add a CI workflow for typecheck, tests and build`, `Fix channel switching and the hero layout on the site`.
- Um pull request, um assunto. A documentação fica em português (pt-BR).
