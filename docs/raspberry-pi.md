# Raspberry Pi

Um Raspberry Pi ligado na TV pelo HDMI vira a TV Gominho: liga direto no canal, em tela cheia, com a biblioteca de um pendrive. Não precisa de internet.

## Como funciona

1. O Pi liga no desktop (login automático).
2. O desktop roda `~/tv-gominho/raspberry-pi/iniciar.sh`. Ele espera o pendrive ser montado (até 2 minutos), acha a biblioteca e inicia o `tv-gominho servir`, que é reiniciado se parar.
3. O Chromium abre `http://localhost:8080` em modo quiosque (tela cheia, sem barras). O app vê que veio do servidor e abre a biblioteca sozinho: a TV começa a passar.

## Instalar

Precisa de um Raspberry Pi 4 ou 5 com o **Raspberry Pi OS com desktop** (Bookworm ou mais novo), e do pacote portátil (`npm run pacote` no computador, depois copie `pacote/tv-gominho` para o Pi ou para o pendrive).

No terminal do Pi, dentro da pasta do pacote:

```sh
bash raspberry-pi/instalar.sh /media/SEU_USUARIO/PENDRIVE/biblioteca
sudo reboot
```

Sem informar a pasta, a biblioteca é procurada a cada vez que o Pi liga: `~/biblioteca`, depois qualquer pendrive com a pasta `biblioteca` (ou com `programas/` na raiz).

O script:

- instala o Node.js 20 ou mais novo e o Chromium, se faltarem. Se o Node.js do sistema for antigo, ele mostra o comando do NodeSource e para;
- copia o pacote para `~/tv-gominho`;
- acrescenta uma linha (marcada com `# tv-gominho`) ao `~/.config/labwc/autostart`, o arquivo que o desktop do Raspberry Pi OS roda ao entrar;
- liga o login automático no desktop e desliga o descanso de tela (`raspi-config nonint do_boot_behaviour B4` e `do_blanking 1`).

Para desfazer: `bash ~/tv-gominho/raspberry-pi/desinstalar.sh`. Para sair da tela cheia: Alt+F4. O registro do servidor fica em `~/.cache/tv-gominho.log`.

## Desempenho

- **Vídeo:** o Pi 5 não tem decodificador de H.264 no chip (só de HEVC): o H.264 é decodificado pelo processador, o que dá conta de 1080p. O Pi 4 tem o decodificador, mas o Chromium nem sempre o usa. Em qualquer caso, vídeos em 720p ou 480p deixam tudo mais leve (a TV Globinho era em definição padrão). Para converter: `tv-gominho converter <biblioteca>`.
- **Efeito CRT:** o quadro só é redesenhado quando o vídeo tem um quadro novo, e o tubo nunca passa de 1,3 milhão de pixels. Se o vídeo começar a perder quadros, a resolução interna do tubo cai sozinha para 75% e depois 50%. Ainda pesado? Menu, Ajustes, CRT: intensidade suave, ou desligado.
- **Controle:** teclado, mini teclado sem fio ou *air mouse*. As setas trocam de canal; Esc abre o menu.

## O que foi testado (e o que não)

Sem um Pi à mão, o modo quiosque foi simulado no PC:

| Teste | Como | Resultado |
|---|---|---|
| `iniciar.sh` | Rodado com um `HOME` falso e um `chromium` de mentira que só registra os argumentos | Acha a biblioteca, sobe o servidor, espera ele responder e abre o navegador com os argumentos certos |
| App servido | Chromium (Edge) sem janela, pelo protocolo de depuração, abrindo `tv-gominho servir` | Abre sozinho no canal, o vídeo toca, 0 quadros perdidos |
| Processador fraco | O mesmo, com o processador 4 e 10 vezes mais lento (`Emulation.setCPUThrottlingRate`) | Sem perda de quadros: o trabalho de JavaScript por quadro é mínimo |
| Placa de vídeo fraca | WebGL por software (SwiftShader) em 1920×1080 | Começou a 48 quadros por segundo; a resolução adaptativa desceu para 75% e foi a 112, sem perder quadros |

O que **não** dá para simular: o decodificador de vídeo e a GPU do Pi de verdade, o Chromium do Raspberry Pi OS e o tempo que o pendrive leva para montar. Esses ficam para o teste num Pi real.

Fontes: [tutorial oficial de modo quiosque](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/) (labwc e `~/.config/labwc/autostart`), [decodificação no Pi 5](https://community.element14.com/products/raspberry-pi/f/raspberry-pi-5-faq/53739/does-the-raspberry-pi-5-support-h265-decoding-or-vc1-decoding/214777).
