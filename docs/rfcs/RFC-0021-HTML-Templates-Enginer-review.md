1 - vamos imaginar que nesse endpoint "https://dashboard.myio-bas.com/api/v1/vh4oks57qq3kdpt54quo/telemetry" 
roda um serviço chamando de EMAIL_SENDER de envio de email para o customer Mestre Álvaro
2 - todo POST para esse endpoint vai ser enviado um PAYLOAD (meu objetivo é determinar esse payload).
Esse payload ora vai ser conteúdo de 
- alarmes
- novos usuários
- relatórios 
- releases notes
- notificações
- insights
3 - Aí o EMAIL_SENDER vai detectar o payload, no payload tem que ter o ENUM do tipo.
Vamos supor que o type = NEW_USER
com isso o EMAIL_SENDER vai chamar uma integração no GCDR para buscar template para NEW_USER do Customer mestre álvaro
Internamente esse endpoint do GCDR vai devolver o template esqueleto já mergeado com o theme do customer 
4 - Aí o EMAIL_SENDER tem do GCDR o template já com as cores do customer Mestre Álvaro para o type NEW_USER que veio no JSON
ele guarda em memória por X mins, a pensar no futuro mas isso é de responsabilidade do EMAIL_SENDER
5 - aí o EMAIL_SENDER com esse template pronto e formatado com as cores, vai iterar no payload de type = NEW_USER
todos os emails, nomes, data de criaçào, mensagem, title, footer, etc, tudo que for de conteúdo para preenhcer o template
Outro exemplo
Aí o EMAIL_SENDER vai detectar o payload, no payload tem que ter o ENUM do tipo.
Vamos supor que o type = ALARM_OPENED
com isso o EMAIL_SENDER vai chamar uma integração no GCDR para buscar template para ALARM_OPENED do Customer mestre álvaro
Internamente esse endpoint do GCDR vai devolver o template esqueleto já mergeado com o theme do customer 
4 - Aí o EMAIL_SENDER tem do GCDR o template já com as cores do customer Mestre Álvaro para o type ALARM_OPENED que veio no JSON
ele guarda em memória por X mins, a pensar no futuro mas isso é de responsabilidade do EMAIL_SENDER
5 - aí o EMAIL_SENDER com esse template pronto e formatado com as cores, vai iterar no payload de type = ALARM_OPENED
todos os emails, nomes, data de criaçào data de criaçào de cada alarme, valor de trigger, valor trigado, duração, etc etc
como esse exemplo aqui
{
  "d3202744-05dd-46d1-af33-495e9a2ecd52:98b3e02b-7c52-44a3-8ebe-d11baec61146:ada23b76-b539-4c78-a4e4-7dbc1fc99355": {
    "vers": "test-manual",
    "rules": {
      "ada23b76-b539-4c78-a4e4-7dbc1fc99355": {
        "name": "Fancoil Ligado Fora do Horario (Seg - Dom)",
        "description": "Fancoil permanece ligado fora do horario permitido de operacao",
        "alarmRecipients": ["rodrigo@myio.com.br", "victor@myio.com.br"],
        "98b3e02b-7c52-44a3-8ebe-d11baec61146": {
          "triggered": true,
          "value": 1,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "online",
          "deviceName": "Fancoil Sala Reuniao 01"
        },
        "988440e6-f927-4140-9f19-3e0fee1075fa": {
          "triggered": true,
          "value": 1,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "online",
          "deviceName": "Fancoil Sala Reuniao 02"
        },
        "133500ee-f9ca-47e8-a3f9-2cc27601bbe5": {
          "triggered": true,
          "value": 1,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "online",
          "deviceName": "Fancoil Corredor Leste"
        }
      },
      "bb11aa22-0001-0001-0001-000000000001": {
        "name": "Temperatura Elevada - Elevador",
        "description": "Temperatura do motor do elevador acima do limite",
        "alarmRecipients": ["rodrigo@myio.com.br"],
        "b3cdd0a4-3764-4a72-9805-e973d2ad608e": {
          "triggered": true,
          "value": 85,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "online",
          "deviceName": "Elevador Torre A - Motor Principal"
        },
        "bde10baa-9d15-438a-995e-d01e6613ac6f": {
          "triggered": true,
          "value": 91,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "online",
          "deviceName": "Elevador Torre B - Motor Principal"
        }
      },
      "cc22bb33-0002-0002-0002-000000000002": {
        "name": "Falha de Comunicacao - Slave Offline",
        "description": "Dispositivo sem resposta Modbus por mais de 5 minutos",
        "alarmRecipients": ["victor@myio.com.br"],
        "bb1e079a-4a7e-470e-8b7c-8a5f41695fc8": {
          "triggered": true,
          "value": 0,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "offline",
          "deviceName": "CLP Subsolo - Painel 01"
        },
        "8be98a43-9594-4689-b04a-114428f9ad9b": {
          "triggered": true,
          "value": 0,
          "time": "2026-03-04T19:52:26.000Z",
          "status": "offline",
          "deviceName": "CLP Cobertura - Painel 02"
        }
      }
    }
  }
}
e etc