Entre no Plan Mode 

Criar um markdown md file no formato RUST RFC em ingles e crie o RFC 0036
Para Migration das Annotations do Thingsboard para o GCDR

Estude tudo de annotations

--

Exemplo em funcionamento para badges 

A MAIN

C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\thingsboard\main-dashboard-shopping\v-5.2.0\WIDGET\MAIN_VIEW\controller.js

Pega hoje o attribute
log_annotations

De cada device 

Veja um exemplo

log_annotations

{"schemaVersion":"1.0.0","deviceId":"26a3fb10-9011-11f0-a06d-e9509531b1d5","lastModified":"2026-04-07T15:18:54.955Z","lastModifiedBy":{"id":"21169bd0-58da-11f0-9291-41f94c09a8a6","email":"alessandro.silva@sacavalcante.com.br","name":"Alessandro Silva"},"annotations":[{"id":"b1e65683-9c05-4fdd-8e4a-61382f1f8145","version":1,"text":"Medidor em algumas horas dos dias não está registrando o consumo","type":"pending","importance":3,"status":"created","createdAt":"2026-04-07T15:18:54.955Z","createdBy":{"id":"21169bd0-58da-11f0-9291-41f94c09a8a6","email":"alessandro.silva@sacavalcante.com.br","name":"Alessandro Silva"},"acknowledged":false,"responses":[],"history":[{"timestamp":"2026-04-07T15:18:54.955Z","userId":"21169bd0-58da-11f0-9291-41f94c09a8a6","userName":"Alessandro Silva","userEmail":"alessandro.silva@sacavalcante.com.br","action":"created"}]},{"id":"55bb1c46-f61a-4a9f-9728-45f8250e1a71","version":2,"text":"Medidor em algumas horas dos dias não está registrando o consumo","type":"pending","importance":3,"status":"created","createdAt":"2026-04-07T15:16:49.848Z","createdBy":{"id":"21169bd0-58da-11f0-9291-41f94c09a8a6","email":"alessandro.silva@sacavalcante.com.br","name":"Alessandro Silva"},"acknowledged":true,"responses":[{"id":"3b2460e9-156e-46e7-abcd-1b570bbb5dcd","annotationId":"55bb1c46-f61a-4a9f-9728-45f8250e1a71","type":"rejected","text":"Já resolvido","createdAt":"2026-04-07T15:17:39.745Z","createdBy":{"id":"21169bd0-58da-11f0-9291-41f94c09a8a6","email":"alessandro.silva@sacavalcante.com.br","name":"Alessandro Silva"}}],"history":[{"timestamp":"2026-04-07T15:16:49.848Z","userId":"21169bd0-58da-11f0-9291-41f94c09a8a6","userName":"Alessandro Silva","userEmail":"alessandro.silva@sacavalcante.com.br","action":"created"},{"timestamp":"2026-04-07T15:17:39.745Z","userId":"21169bd0-58da-11f0-9291-41f94c09a8a6","userName":"Alessandro Silva","userEmail":"alessandro.silva@sacavalcante.com.br","action":"rejected","previousVersion":1}],"acknowledgedBy":{"id":"21169bd0-58da-11f0-9291-41f94c09a8a6","email":"alessandro.silva@sacavalcante.com.br","name":"Alessandro Silva"},"acknowledgedAt":"2026-04-07T15:17:39.745Z"}]}

---



C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\components\premium-modals\settings\annotations

C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\docs\rfcs\RFC-0151-Add-Imagem-At-Annotations.draft.md

C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\docs\rfcs\RFC-0104-Device-Annotations-System.md

C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\docs\rfcs\RFC-0104-NewAttributeServerScope-Annotations.draft copy.md

C:\Projetos\GitHub\myio\myio-js-library-PROD.git\src\docs\rfcs\RFC-0203-HeaderAnnotationsButton.md



---

temos que criar uma tabela 
annotations

e registrar as anotações 

e ver como podemos salvar os eventos de reject, approved, archived, etc, bem como salvar os comentários, 
e novas features como menções a outros users, a outros devices e poder salvar um anexo na anotação ou no comentário de uma anotação

a faz parte da atividade a migração dos dados para o GCDR mas enquanto isso iremos conviver com o legado

crie apenas o RFC não codifique nada, vai ser algo para o futuro
