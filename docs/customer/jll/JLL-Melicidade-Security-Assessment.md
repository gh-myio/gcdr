# JLL / Melicidade — Security Assessment

**Project:** Telemetry and Automation Project for JLL's client, Melicidade (Mercado Livre).

> Working document. Answers must be validated internally and supported by evidence before submission.

## 1. Project and data hosting

### Which project or engagement does this assessment relate to?

**Answer**

> Telemetry and Automation Project for JLL's client, Melicidade (Mercado Livre).

### Where do you host your customer data?

**Answer**

> Customer data is hosted in a secure AWS cloud environment, using managed infrastructure and storage services, with continuous monitoring, observability, access controls, and security safeguards in place.

**Notes**

- The environment currently uses AWS services such as EC2 and S3.
- Avoid disclosing instance names, IP addresses, network architecture, configurations, or credentials.
- If requested, AWS regions, encryption, backups, retention, and disaster recovery should be confirmed internally before disclosure.

## 2. Data sovereignty and privacy

### Does the company have a policy covering the data sovereignty requirements and protection of customer data?

**Proposed answer — Yes, subject to internal evidence**

> Yes. The company maintains data protection and privacy policies aligned with Brazil's General Data Protection Law (LGPD), including requirements for customer data security, data residency, and international data transfers, where applicable.

**Conservative alternative**

> The company maintains data protection and privacy practices aligned with Brazil's General Data Protection Law (LGPD). Data sovereignty, residency, and international data transfer requirements are assessed according to applicable legislation and customer contractual requirements.

**Notes**

- Use **Yes** only if there is a formally documented policy.
- LGPD compliance is relevant, but data sovereignty also covers residency and international transfers.

### If required, would the organization be able to provide data sovereignty for clients that do not want their data outside their local region?

**Answer**

> Yes. If required, we can configure the client's environment so that customer data, including applicable backups, remains within an agreed AWS region. This requirement would be assessed during solution design and formally defined in the contract, subject to technical and service-specific dependencies.

**Notes**

- Validate whether logs, backups, support services, subprocessors, and disaster-recovery copies also remain in the agreed region.
- Define the geographical boundary and contractual requirements before making an absolute commitment.

## 3. Security management

### 4.1 Have responsibilities for the management and operation of an information security program been formally assigned in your company?

**Selected answer: Yes**

> Overall responsibility for the information security program is formally assigned to the company's Technology Leadership, under the responsibility of the Chief Technology Officer (CTO). This role oversees security governance, risk management, access controls, incident response, infrastructure security, and compliance with applicable data protection requirements, including the LGPD.

**Notes**

- Prefer identifying the responsible role rather than a person's name.
- Confirm the correct role internally. Evidence may include a policy, organization chart, employment agreement, or formal job description.

### Does the company manage its information security practices according to any industry-recognized frameworks?

**Selected answer: None**

> None. The company has not formally adopted or certified its information security program against an industry-recognized control framework. However, it applies security practices such as access controls, monitoring, logging, backups, vulnerability management, and incident response, in accordance with applicable legal and contractual requirements, including Brazil's LGPD. Formal adoption of a recognized framework may be considered as the security program matures.

**Notes**

- Do not select ISO 27001, NIST, CIS, SOC 2, or another framework solely because some internal practices are compatible with it.

### Does the company have documented security policies and processes that are approved by management and include an exception process from standard policies?

**Selected answer: Yes**

> Yes. The company maintains documented information security policies and operational procedures that are reviewed and approved by management. Deviations from established controls must be formally assessed, justified, authorized by the appropriate management level, documented, and periodically reviewed.

**Notes**

- Validate with approved policies, approval records, and documented exception requests.

### Are independent audit and assurance assessments performed according to risk-based plans and policies?

**Selected answer: Yes**

> Yes. Independent audit and assurance assessments are performed periodically based on identified risks, applicable legal and contractual requirements, and management priorities. Findings are documented, assigned to responsible owners, tracked through remediation, and reported to management.

**Notes**

- Confirm that assessments are performed by a party independent of the controls being assessed.
- Supporting evidence may include audit reports, assessment plans, findings, and remediation records.

### Does the company hold any information security certifications?

**Selected answer: None of the above**

> The company does not currently hold a formal information security certification under the frameworks listed above. Nevertheless, security and data protection controls are implemented as part of its operational practices and applicable legal and contractual obligations, including compliance with Brazil's LGPD.

**Options considered:** ISO 27001; SOC 2 / SOC 3; NIST / CMMC; FedRAMP; CSA — Cloud Security Alliance; Other; None of the above.

**Notes**

- Do not claim a certification without a valid certificate or independent assurance report that can be attached.
- Using practices inspired by a framework is not the same as holding a certification.

## 4. Risk management and threat intelligence

### Does the organization have a formal risk management program?

**Selected answer: Yes**

> The company maintains a formal risk management program to identify, assess, prioritize, and address information security, operational, and data protection risks. Risks are evaluated according to their likelihood and potential impact, assigned to responsible owners, and treated through mitigation, acceptance, transfer, or avoidance. Significant risks and corresponding remediation actions are periodically reviewed by management.

**Notes**

- Confirm supporting evidence such as a risk register or matrix, named owners, treatment plans, and management review records.

### What sources do you use for ongoing threat intelligence?

**Answer**

> We use multiple sources for ongoing threat intelligence, including AWS security advisories and monitoring services, CERT.br and CISA alerts, the CVE/NVD vulnerability databases, security advisories from technology vendors, and automated dependency vulnerability notifications. Relevant threats are reviewed and prioritized based on their potential impact on our environment and customers.

**Notes**

- Retain only sources that are actually monitored.
- If applicable, confirm and name services such as AWS GuardDuty, AWS Security Hub, AWS Inspector, GitHub Dependabot, or npm audit.

### Are risks regularly reviewed for prioritization and mitigation?

**Selected answer: Yes**

> Risks are reviewed periodically and whenever significant changes or new threats arise. They are prioritized according to likelihood, potential impact, and business relevance. Mitigation actions are assigned to responsible owners, tracked to completion, and escalated to management when appropriate.

**Notes**

- Confirm the review frequency and retain evidence of reviews, assigned actions, deadlines, and escalation.

## 5. Customer Data Policy

### 6.1 Does the vendor have a policy covering the protection of customer data?

**Selected answer: Yes**

> Yes. The company maintains a documented policy for protecting customer data throughout its lifecycle. The policy addresses appropriate access controls, data classification and handling, secure storage and transmission, retention and disposal, incident response, and compliance with applicable legal, regulatory, and contractual requirements, including Brazil's LGPD.

**Notes**

- Confirm that the policy is documented, approved by management, communicated to relevant personnel, and periodically reviewed.
- Supporting evidence may include the approved policy, revision history, employee acknowledgement or training records, and related operating procedures.

## 6. Privacy Management

### 7.1 Does the company have an appointed Privacy Officer?

**Selected answer: Yes**

> Yes. The company has appointed a Privacy Officer responsible for overseeing the privacy program, supporting compliance with applicable data protection requirements, including Brazil's LGPD, and serving as a point of contact for privacy-related matters and data-subject requests.

**Notes**

- Confirm the formally appointed person or role. Under the LGPD, this function may be identified as the Data Protection Officer (DPO) or *Encarregado pelo Tratamento de Dados Pessoais*.
- Evidence may include the appointment record, role description, privacy notice, organization chart, and published contact channel.

### 7.2 Does the company have a privacy policy?

**Selected answer: Yes**

> Yes. The company maintains a documented privacy policy describing how personal data is collected, used, stored, protected, retained, shared, and disposed of in accordance with applicable legal and contractual requirements, including Brazil's LGPD.

**Notes**

- Confirm management approval, policy owner, effective date, review cycle, and availability to relevant stakeholders.

### 7.3 Does the company require all personnel to complete privacy training?

**Answer pending internal confirmation**

If training is mandatory for everyone and completion is tracked, select **Yes**:

> Yes. All personnel are required to complete privacy and data protection training upon onboarding and periodically thereafter. Completion is tracked, and the training covers applicable privacy requirements, secure handling of personal data, incident reporting, and personnel responsibilities under the company's policies and Brazil's LGPD.

Otherwise, select **No**:

> No. Privacy guidance is currently provided to relevant personnel, but a mandatory, organization-wide privacy training program with formal completion tracking has not yet been fully implemented.

**Notes**

- “All personnel” normally includes employees and relevant contractors.
- A **Yes** answer should be supported by training materials, attendance or completion records, onboarding requirements, and a defined refresher frequency.

## Submission checklist
 
## 8. Personnel screening

### 8.1 Do all company personnel undergo background checks in compliance with local laws prior to employment?

**Selected answer: Yes — confirmed by the user.**

Select **Yes** only if all personnel undergo pre-employment background screening in accordance with applicable local laws:

> Yes. All personnel undergo pre-employment background checks in accordance with applicable local laws. The scope of screening is appropriate to the role and limited to legally permitted checks.

If this is not required for all personnel before employment, select **No**:

> No. Pre-employment background checks are not currently required for all company personnel.

**Observações:** confirmar com RH a abrangência, o momento das verificações e os registros disponíveis. Não declarar verificações de antecedentes criminais sem confirmar que são realizadas e juridicamente aplicáveis.

## Submission checklist (continued)
 
### 8.2 Do all company personnel receive training on security responsibilities, policies, and procedures at the time of hire?

**Selected answer: Yes — confirmed by the user.**

If all personnel receive this training at the time of hire, select **Yes**:

> Yes. All company personnel receive training on their security responsibilities and the company's security policies and procedures as part of onboarding.

Otherwise, select **No**:

> No. Security training at the time of hire is not currently provided to all company personnel.

**Observações:** confirmar se o treinamento de admissão abrange todos e guardar os registros de participação. A confirmação de verificações de antecedentes na pergunta 8.1 não confirma este controle.

## Submission checklist — validation items

### 8.3 Do all company personnel receive ongoing communication of security responsibilities, policies, and procedures?

**Selected answer: Yes — confirmed by the user.**

**Yes** if all personnel receive recurring communications about security responsibilities, policies, and procedures. Otherwise, **No**.

**Observações:** treinamento apenas na admissão não confirma comunicação contínua; exemplos incluem comunicados periódicos, atualizações de políticas e lembretes enviados a todos.

### 8.4 Do you conduct internal phishing tests?

**Selected answer: No — confirmed by the user.**

**Yes** if the company conducts internal phishing simulations. Otherwise, **No**.

**Observações:** filtros antispam e orientações sobre phishing não equivalem a testes internos de phishing.

## Validation checklist

### 8.5 If any employees or contractors work outside of the country where data may be regulated or controlled by contractual requirements, please list those countries:

**Selected answer: Not applicable (N/A) — supplied by the user.**

**Suggested justification, if confirmed:**

> Not applicable. No employees or contractors work outside the country specified by the applicable data regulatory or contractual requirements.

**Observações:** esta justificativa pressupõe que não há funcionários ou prestadores trabalhando fora do país abrangido pelos requisitos aplicáveis. Considerar também trabalho remoto; a localização da hospedagem, por si só, não responde à pergunta.

## Validation checklist (continued)

## 9. End User Asset Management (Vendor Employees)

### 9.1 Definition of Employee Assets

The questions in this section refer to end-user assets for all vendor employees who may have access to customer data, including customer support, technical support, account representatives, and developers.

**Attachment: Optional — skipped by the user.**

### 9.2 Do you maintain a formal inventory of assets assigned to each employee?

**Selected answer: Yes — confirmed by the user.**

> Yes. We maintain a formal inventory of assets assigned to each employee, identifying the equipment and the employee responsible for it.

**Observações:** o inventário pode ser mantido em planilha ou sistema. Confirmar o procedimento de atualização em entregas, transferências e devoluções antes de descrever esse procedimento como prática estabelecida.

## Validation checklist — remaining items

### 9.3 Are all user laptops / desktops protected by anti-virus and anti-malware software?

**Answer: Pending user confirmation.**

### 9.4 Are all user laptops / desktops configured to receive anti-virus updates automatically?

**Answer: Pending user confirmation.**

### 9.5 Are all user laptops / desktops password protected?

**Answer: Pending user confirmation.**

### 9.6 Are all user laptops / desktops protected with inactivity time-outs shorter than 15 minutes?

**Answer: Pending user confirmation.**

**Observação:** o intervalo deve ser inferior a 15 minutos; exatamente 15 minutos não atende ao texto.

### Are the hard drives on all user laptops / desktops encrypted?

**Selected answer: No — confirmed by the user.**

> No. Full-disk encryption is not currently implemented on all user laptops and desktops.

**Observação:** a resposta indica que a criptografia não cobre todos os equipamentos; não implica que nenhum esteja criptografado. Número do item não informado.

## Validation checklist — outstanding evidence

### Are all user laptops / desktops prevented from using detachable / portable media?

**Selected answer: No — confirmed by the user.**

### Are USB ports blocked to prevent read / write activity to portable and detachable media?

**Selected answer: No — confirmed by the user.**

**Justification for both answers:**

> No. The use of removable or portable storage media is not blocked on all user laptops and desktops. USB ports are not universally restricted to prevent read and write access to such media.

**Observações:** não foram confirmados controles compensatórios nem planos de implantação; não declarar monitoramento, autorização prévia ou bloqueios seletivos sem confirmação.

## Validation checklist — supporting evidence

## 10. Employee & Information Mobility

### 10.1 Are employees expected or allowed to use mobile devices with customer data?

**Selected answer: Yes — confirmed by the user.**

### 10.2 Are employees required to connect to the company network via VPN before accessing customer data?

**Selected answer: No — confirmed by the user.**

> No. VPN connectivity is not a mandatory prerequisite for employees to access customer data from mobile devices.

**Observações:** não foram confirmados os controles específicos deste acesso. Não declarar MFA, HTTPS, acesso condicional ou outros controles compensatórios sem confirmação.

### 10.3 Are all employee mobile devices password or passcode protected?

**Selected answer: Yes — confirmed by the user.**

### 10.4 Are all employee mobile devices configured with inactivity time-outs?

**Selected answer: Yes — confirmed by the user.**

### 10.5 Are all employee mobile devices encrypted?

**Selected answer: No — confirmed by the user.**

### 10.6 Are all employee mobile devices managed with Mobile Device Management (MDM) software?

**Selected answer: No — confirmed by the user.**

### 10.7 Can all employee mobile devices be remotely wiped if lost or stolen?

**Selected answer: Yes — confirmed by the user.**

**Observações:** o mecanismo de apagamento remoto não foi informado. Não atribuir essa capacidade a MDM, pois a resposta 10.6 é No.

## Validation checklist — evidence to confirm

## 11. Infrastructure Asset Management

### 11.1 Where do you host your customer-facing systems?

**Selected answer: Amazon Web Services (AWS) — confirmed by the user.**

> Our customer-facing systems are hosted on Amazon Web Services (AWS), using services such as Amazon EC2 for compute and Amazon S3 for storage. The environment includes monitoring and observability capabilities.

### 11.2 Are all infrastructure assets maintained in a formal inventory?

Infrastructure assets include servers, databases, routers, switches, and load balancers.

**Selected answer: Yes — confirmed by the user.**

### 11.3 How are infrastructure images/profiles backed up and restored?

**User-provided basis: Gestão TIC.**

**Proposed wording:**

> Infrastructure image and configuration backup and restoration activities are managed by our Information and Communication Technology (ICT) team.

**Observações:** esta resposta identifica o responsável. A pergunta também solicita o método; ferramentas, frequência, retenção, armazenamento e procedimento de restauração ainda não foram informados. Não declarar backups automáticos ou testes de restauração sem confirmação.

### 11.4 Are all servers and databases protected by anti-virus, anti-malware, and/or other endpoint protection technology?

**Selected answer: Yes — confirmed by the user.**

### 11.5 Are anti-virus / anti-malware tools configured to automatically install profile updates?

**Selected answer: Yes — confirmed by the user.**

### 11.6 Are devices hardened according to vendor recommendations prior to deployment?

Hardening could include the removal of default accounts, disabling unneeded services, and restricting local accounts.

**Selected answer: No — confirmed by the user.**

### 11.7 Are servers and databases configured with endpoint intrusion detection and prevention tools?

**Selected answer: Yes — confirmed by the user.**

### 11.8 How frequently are infrastructure assets patched with manufacturer updates?

**Selected answer: Ad hoc — confirmed by the user.**

> Infrastructure assets are patched on an ad hoc basis rather than according to a fixed schedule.

### 11.9 Do you allow the use of infrastructure assets that are no longer under vendor support/updates?

**Selected answer: No — confirmed by the user.**

## Validation checklist — remaining evidence

## 12. Change Management

### 12.1 Does the firm have a formal change management process required for all changes to all asset categories?

**Selected answer: No — confirmed by the user.**

### 12.2 Which of the following are required components of the change management process?

**Selected options — supplied by the user:**

- Change procedure documentation.
- Change testing procedures.
- Success/failure criteria.

**Clarification:**

> Our change management practices include change procedure documentation, change testing procedures, and success/failure criteria. However, a formal change management process is not required for all changes across all asset categories.

**Observações:** os componentes selecionados não confirmam um processo formal obrigatório para todas as mudanças. Validar que são efetivamente exigidos no escopo em que se aplicam, conforme a redação de 12.2.

### 12.3 Are customers notified of all planned changes to customer environments prior to the implementation date?

**Selected answer: No — confirmed by the user.**

**Observação:** a resposta não implica ausência de toda comunicação; indica que não se confirma notificação prévia de todas as mudanças planejadas.

### 12.4 Are formal procedures in place for managing emergency changes?

**Selected answer: No — confirmed by the user.**

## Validation checklist — pending evidence

## 22. Security Incident Management

### 22.1 Is an information security incident management program in place and properly resourced?

**Answer: No — based on the user's statement that this process does not yet exist.**

> No. An information security incident management program is not currently in place. A draft process template has been prepared for further development and approval.

### 22.2 Is the information security incident management plan tested at least annually?

**Answer: No — consistent with the absence of an implemented plan.**

> No. A formal information security incident management plan has not yet been implemented, and annual testing has not been established.

**Observações:** o template em clientes/MYIO/processos é um rascunho, não um plano aprovado ou evidência de teste. Nenhuma data de implantação ou teste foi confirmada.

## 18. Logging & Monitoring

### 18.6 How long are application log files retained?

**Answer: Three years — confirmed by the user.**

> Application log files are retained for three years.

### 18.5 Do application security events trigger automated notifications?

**Selected answer: Yes — confirmed by the user.**

> Yes. Application security events trigger automated notifications.

### 18.4 Are application logs monitored for evidence of prohibited or anomalous activity?

**Selected answer: Yes — confirmed by the user.**

> Yes. Application logs are monitored for evidence of prohibited or anomalous activity.

**Observações:** frequência, ferramentas e uso de SIEM não foram confirmados por esta resposta.

## 16. Open-source libraries — repository review

### Please list the open-source libraries used in your products.

> Our products use open-source libraries including Express, Fastify, React, React Native, Expo, Node-RED, Zod, Yup, Drizzle ORM, TypeORM, Sequelize, postgres (Postgres.js), pg (node-postgres), BullMQ, ioredis, MQTT.js, Aedes, Axios, Undici, ws, bcryptjs, Helmet, express-rate-limit, Passport, jsonwebtoken, AWS SDK for JavaScript, Nodemailer, Pino, Winston, Lodash, Moment.js, date-fns, Redux, React Navigation, Material UI, Emotion, styled-components, Tailwind CSS, Chart.js, ECharts, Recharts, jsPDF, and html2canvas. Development and testing tools include TypeScript, ESLint, Jest, Vitest, Mocha, Chai, Sinon, Vite, Webpack, and esbuild. This is a representative list of direct dependencies declared in the reviewed repositories; a detailed manifest inventory is maintained separately.

**Escopo:** gcdr.git, alarms-backend.git (alarm-orchestrator), monorepo.git e data-ingestion.git. Foram lidos os package.json encontrados pelo rg, incluindo subprojetos. Não inclui os repositórios separados de frontend, data-ingestion-prod.git, dependências transitivas ou diretórios ignorados pelo rg. Versões abaixo são faixas declaradas, não versões instaladas. Não foi realizada auditoria de licenças nem validação de implantação. Componentes internos MYIO não devem ser classificados automaticamente como open source. Manifests em caminhos legados, como nodered_old, estão incluídos como evidência do repositório, não como confirmação de uso em produção.

### Manifest inventory: gcdr.git

| Package | Declared version | Manifest | Dependency group |
|---|---|---|---|
| @anthropic-ai/sdk | ^0.104.1 | package.json | dependencies |
| @aws-sdk/client-dynamodb | ^3.400.0 | package.json | dependencies |
| @aws-sdk/client-eventbridge | ^3.400.0 | package.json | dependencies |
| @aws-sdk/client-s3 | ^3.1037.0 | package.json | dependencies |
| @aws-sdk/lib-dynamodb | ^3.400.0 | package.json | dependencies |
| @aws-sdk/s3-request-presigner | ^3.1037.0 | package.json | dependencies |
| @modelcontextprotocol/sdk | ^1.29.0 | package.json | dependencies |
| @types/aws-lambda | ^8.10.119 | package.json | devDependencies |
| @types/bcryptjs | ^2.4.6 | package.json | devDependencies |
| @types/compression | ^1.7.5 | package.json | devDependencies |
| @types/cors | ^2.8.17 | package.json | devDependencies |
| @types/express | ^4.17.21 | package.json | devDependencies |
| @types/jest | ^29.5.3 | package.json | devDependencies |
| @types/js-yaml | ^4.0.9 | package.json | devDependencies |
| @types/multer | ^2.1.0 | package.json | devDependencies |
| @types/node | ^20.4.5 | package.json | devDependencies |
| @types/nodemailer | ^7.0.9 | package.json | devDependencies |
| @types/pg | ^8.16.0 | package.json | devDependencies |
| @types/swagger-ui-express | ^4.1.6 | package.json | devDependencies |
| @types/uuid | ^9.0.2 | package.json | devDependencies |
| @typescript-eslint/eslint-plugin | ^6.2.0 | package.json | devDependencies |
| @typescript-eslint/parser | ^6.2.0 | package.json | devDependencies |
| bcryptjs | ^3.0.3 | package.json | dependencies |
| compression | ^1.7.4 | package.json | dependencies |
| cors | ^2.8.5 | package.json | dependencies |
| drizzle-kit | ^0.31.8 | package.json | devDependencies |
| drizzle-orm | ^0.45.1 | package.json | dependencies |
| esbuild | ^0.18.17 | package.json | devDependencies |
| eslint | ^8.46.0 | package.json | devDependencies |
| eslint-plugin-jest | ^27.9.0 | package.json | devDependencies |
| eslint-plugin-sonarjs | ^0.25.1 | package.json | devDependencies |
| express | ^4.21.0 | package.json | dependencies |
| express-rate-limit | ^8.5.2 | package.json | dependencies |
| helmet | ^8.0.0 | package.json | dependencies |
| jest | ^29.6.2 | package.json | devDependencies |
| jest-junit | ^16.0.0 | package.json | devDependencies |
| js-yaml | ^4.1.1 | package.json | dependencies |
| multer | ^2.1.1 | package.json | dependencies |
| nodemailer | ^7.0.13 | package.json | dependencies |
| postgres | ^3.4.8 | package.json | dependencies |
| serverless | ^3.34.0 | package.json | devDependencies |
| serverless-dotenv-plugin | ^6.0.0 | package.json | devDependencies |
| serverless-esbuild | ^1.46.0 | package.json | devDependencies |
| serverless-offline | ^12.0.4 | package.json | devDependencies |
| serverless-plugin-split-stacks | ^1.14.0 | package.json | devDependencies |
| swagger-ui-express | ^5.0.0 | package.json | dependencies |
| ts-jest | ^29.1.1 | package.json | devDependencies |
| tsx | ^4.7.0 | package.json | devDependencies |
| typescript | ^5.1.6 | package.json | devDependencies |
| uuid | ^9.0.0 | package.json | dependencies |
| zod | ^3.22.0 | package.json | dependencies |

### Manifest inventory: alarms-backend.git

| Package | Declared version | Manifest | Dependency group |
|---|---|---|---|
| @aws-sdk/client-secrets-manager | ^3.712.0 | package.json | dependencies |
| @bull-board/api | ^6.17.0 | package.json | dependencies |
| @bull-board/fastify | ^6.17.0 | package.json | dependencies |
| @fastify/cors | ^10.0.1 | package.json | dependencies |
| @fastify/helmet | ^12.0.1 | package.json | dependencies |
| @fastify/static | ^9.0.0 | package.json | dependencies |
| @fastify/swagger | ^9.4.0 | package.json | dependencies |
| @fastify/swagger-ui | ^5.2.0 | package.json | dependencies |
| @fastify/websocket | ^11.2.0 | package.json | dependencies |
| @types/node | ^22.10.5 | package.json | devDependencies |
| @types/nodemailer | ^7.0.11 | package.json | devDependencies |
| @types/ws | ^8.18.1 | package.json | devDependencies |
| @typescript-eslint/eslint-plugin | ^8.19.1 | package.json | devDependencies |
| @typescript-eslint/parser | ^8.19.1 | package.json | devDependencies |
| @vitest/coverage-v8 | ^2.1.8 | package.json | devDependencies |
| bullmq | ^5.34.3 | package.json | dependencies |
| cross-env | ^10.1.0 | package.json | devDependencies |
| date-fns | ^4.1.0 | package.json | dependencies |
| drizzle-kit | ^0.30.2 | package.json | devDependencies |
| drizzle-orm | ^0.38.4 | package.json | dependencies |
| eslint | ^9.18.0 | package.json | devDependencies |
| eslint-config-prettier | ^9.1.0 | package.json | devDependencies |
| eslint-plugin-import | ^2.31.0 | package.json | devDependencies |
| fastify | ^5.2.0 | package.json | dependencies |
| handlebars | ^4.7.8 | package.json | dependencies |
| ioredis | ^5.4.2 | package.json | dependencies |
| nanoid | ^5.0.9 | package.json | dependencies |
| nodemailer | ^8.0.1 | package.json | dependencies |
| pino | ^9.6.0 | package.json | dependencies |
| pino-pretty | ^13.0.0 | package.json | dependencies |
| postgres | ^3.4.5 | package.json | dependencies |
| prettier | ^3.4.2 | package.json | devDependencies |
| rimraf | ^6.0.1 | package.json | devDependencies |
| tsx | ^4.19.2 | package.json | devDependencies |
| typescript | ^5.7.3 | package.json | devDependencies |
| undici | ^7.2.0 | package.json | dependencies |
| vitest | ^2.1.8 | package.json | devDependencies |
| ws | ^8.19.0 | package.json | dependencies |
| zod | ^3.24.1 | package.json | dependencies |

### Manifest inventory: monorepo.git

| Package | Declared version | Manifest | Dependency group |
|---|---|---|---|
| @aws-cdk/aws-s3-deployment | 1.204.0 | cloud/app/package.json | devDependencies |
| @babel/core | 7.14.8 | cloud/app/package.json | devDependencies |
| @babel/preset-env | 7.14.9 | cloud/app/package.json | devDependencies |
| @babel/runtime | 7.14.8 | cloud/app/package.json | devDependencies |
| @commitlint/cli | 12.1.4 | cloud/app/package.json | devDependencies |
| @commitlint/cli | 12.1.4 | cloud/backend/package.json | devDependencies |
| @commitlint/config-conventional | 12.1.4 | cloud/app/package.json | devDependencies |
| @commitlint/config-conventional | 12.1.4 | cloud/backend/package.json | devDependencies |
| @commitlint/prompt-cli | 12.1.4 | cloud/app/package.json | devDependencies |
| @expo/react-native-action-sheet | 3.10.0 | cloud/app/package.json | dependencies |
| @expo/webpack-config | ^19.0.0 | cloud/app/package.json | devDependencies |
| @hookform/resolvers | 2.8.8 | cloud/app/package.json | dependencies |
| @node-red-contrib-themes/midnight-red | ^2.2.3 | gateways/api/package.json | dependencies |
| @nrwl/workspace | ^17.0.0 | package.json | devDependencies |
| @react-native-async-storage/async-storage | 1.15.5 | cloud/app/package.json | dependencies |
| @react-native-clipboard/clipboard | 1.8.5 | cloud/app/package.json | dependencies |
| @react-native-community/blur | 3.6.0 | cloud/app/package.json | dependencies |
| @react-native-community/eslint-config | 3.0.0 | cloud/app/package.json | devDependencies |
| @react-native-community/masked-view | 0.1.11 | cloud/app/package.json | dependencies |
| @react-native-community/slider | 3.0.3 | cloud/app/package.json | dependencies |
| @react-native-picker/picker | 2.2.1 | cloud/app/package.json | dependencies |
| @react-native-segmented-control/segmented-control | 2.4.0 | cloud/app/package.json | dependencies |
| @react-navigation/bottom-tabs | 6.0.9 | cloud/app/package.json | dependencies |
| @react-navigation/core | 6.0.3 | cloud/app/package.json | dependencies |
| @react-navigation/native | 6.0.6 | cloud/app/package.json | dependencies |
| @react-navigation/native-stack | 6.2.5 | cloud/app/package.json | dependencies |
| @react-navigation/routers | 6.0.2 | cloud/app/package.json | dependencies |
| @redux-saga/is | 1.1.2 | cloud/app/package.json | devDependencies |
| @redux-saga/symbols | 1.1.2 | cloud/app/package.json | devDependencies |
| @sentry/react-native | 3.2.13 | cloud/app/package.json | dependencies |
| @tanstack/react-table | 8.21.2 | cloud/app/package.json | dependencies |
| @types/express | ^4.17.21 | cloud/config-server/package.json | devDependencies |
| @types/jest | 26.0.24 | cloud/app/package.json | devDependencies |
| @types/lodash | 4.14.172 | cloud/app/package.json | devDependencies |
| @types/node | 22.14.0 | cloud/app/package.json | devDependencies |
| @types/node | ^22.10.0 | cloud/config-server/package.json | devDependencies |
| @types/react | 17.0.19 | cloud/app/package.json | devDependencies |
| @types/react-native | 0.64.12 | cloud/app/package.json | devDependencies |
| @types/react-native-vector-icons | 6.4.8 | cloud/app/package.json | devDependencies |
| @types/react-redux | 7.1.18 | cloud/app/package.json | devDependencies |
| @types/react-test-renderer | 17.0.1 | cloud/app/package.json | devDependencies |
| @types/uuid | ^10.0.0 | cloud/config-server/package.json | devDependencies |
| @types/ws | ^8.5.13 | cloud/config-server/package.json | devDependencies |
| @typescript-eslint/eslint-plugin | 4.28.5 | cloud/app/package.json | devDependencies |
| @typescript-eslint/parser | 4.28.4 | cloud/app/package.json | devDependencies |
| apisauce | 1.1.2 | cloud/app/package.json | dependencies |
| async | 2.6.3 | gateways/api/package.json | dependencies |
| aws-cdk | 2.1007.0 | cloud/app/package.json | devDependencies |
| aws-cdk-lib | 2.188.0 | cloud/app/package.json | devDependencies |
| aws-sdk | 2.540.0 | cloud/backend/package.json | dependencies |
| axios | ^1.6.7 | gateways/api/nodered_nodes/node-red-contrib-myio-monitoring/package.json | dependencies |
| axios | ^1.6.7 | gateways/nodered-nodes/nodes/myio-monitoring/package.json | dependencies |
| babel-jest | 26.6.3 | cloud/app/package.json | devDependencies |
| babel-loader | 8.2.2 | cloud/app/package.json | devDependencies |
| babel-plugin-macros | 3.1.0 | cloud/app/package.json | devDependencies |
| babel-plugin-module-resolver | 4.1.0 | cloud/app/package.json | devDependencies |
| babel-preset-expo | 8.4.1 | cloud/app/package.json | devDependencies |
| bcryptjs | 2.4.3 | cloud/backend/package.json | dependencies |
| bcryptjs | 2.4.3 | gateways/api/package.json | dependencies |
| bluebird | 3.5.5 | cloud/backend/package.json | dependencies |
| bluebird | 3.5.5 | gateways/api/package.json | dependencies |
| body-parser | 1.18.3 | cloud/backend/package.json | dependencies |
| body-parser | 1.18.3 | gateways/api/package.json | dependencies |
| chai | 4.1.2 | cloud/backend/package.json | devDependencies |
| chai-http | ^4.3.0 | cloud/backend/package.json | devDependencies |
| commitlint | 12.1.4 | cloud/app/package.json | devDependencies |
| compression | 1.7.4 | gateways/api/package.json | dependencies |
| constructs | 10.4.2 | cloud/app/package.json | devDependencies |
| cookie-parser | 1.4.5 | gateways/api/package.json | dependencies |
| cors | 2.8.5 | cloud/backend/package.json | dependencies |
| cors | 2.8.5 | gateways/api/package.json | dependencies |
| debug | 3.1.0 | cloud/backend/package.json | devDependencies |
| dotenv | 4.0.0 | cloud/backend/package.json | dependencies |
| eslint | 7.31.0 | cloud/app/package.json | devDependencies |
| eslint-config-standard-with-typescript | 20.0.0 | cloud/app/package.json | devDependencies |
| eslint-plugin-import | 2.23.4 | cloud/app/package.json | devDependencies |
| eslint-plugin-node | 11.1.0 | cloud/app/package.json | devDependencies |
| eslint-plugin-promise | 5.1.0 | cloud/app/package.json | devDependencies |
| expo | 52.0.44 | cloud/app/package.json | dependencies |
| express | 4.16.4 | cloud/backend/package.json | dependencies |
| express | ^4.21.0 | cloud/config-server/package.json | dependencies |
| express | 4.16.4 | gateways/api/package.json | dependencies |
| express-session | 1.16.2 | cloud/backend/package.json | dependencies |
| fuse.js | 6.6.2 | cloud/app/package.json | dependencies |
| husky | 7.0.1 | cloud/app/package.json | devDependencies |
| inquirer | 7.0.7 | gateways/api/package.json | devDependencies |
| install | 0.12.2 | gateways/api/package.json | dependencies |
| is-ci | 3.0.0 | cloud/app/package.json | devDependencies |
| jest | 26.6.3 | cloud/app/package.json | devDependencies |
| jest-expo | 42.1.0 | cloud/app/package.json | devDependencies |
| jest-junit | 12.0.0 | cloud/app/package.json | devDependencies |
| jsonwebtoken | 8.1.1 | cloud/backend/package.json | dependencies |
| jsonwebtoken | 8.3.0 | gateways/api/package.json | dependencies |
| jsonwebtoken | ^9.0.2 | gateways/erlradio/websocket_client/package.json | dependencies |
| lint-staged | 11.1.1 | cloud/app/package.json | devDependencies |
| lodash | 4.17.21 | cloud/app/package.json | dependencies |
| lodash | 4.17.21 | gateways/api/package.json | dependencies |
| method-override | 2.3.10 | cloud/backend/package.json | dependencies |
| metro | 0.82.1 | cloud/app/package.json | dependencies |
| metro-react-native-babel-preset | 0.66.2 | cloud/app/package.json | devDependencies |
| mocha | 4.0.1 | cloud/backend/package.json | devDependencies |
| moment | 2.29.1 | cloud/app/package.json | dependencies |
| moment | 2.19.4 | cloud/backend/package.json | dependencies |
| moment | 2.22.2 | gateways/api/package.json | dependencies |
| moment-timezone | 0.5.34 | cloud/app/package.json | dependencies |
| nanoid | 3.3.0 | cloud/app/package.json | dependencies |
| node-fetch | 2.6.2 | cloud/backend/package.json | dependencies |
| node-red | ^4.0.9 | gateways/api/package.json | dependencies |
| node-red-contrib-postgresql | ~0.14.2 | gateways/api/nodered_old/package.json | dependencies |
| node-red-contrib-postgresql | ^0.15.1 | gateways/api/package.json | dependencies |
| node-red-contrib-wait-paths | ^0.3.2 | gateways/api/package.json | dependencies |
| node-red-dashboard | ^3.6.5 | gateways/api/package.json | dependencies |
| node-red-node-ui-list | 0.3.4 | gateways/api/package.json | dependencies |
| node-schedule | 1.3.2 | gateways/api/package.json | dependencies |
| node-ygghelper | file:./ygghelper | cloud/backend/package.json | dependencies |
| nodemailer | 4.4.2 | cloud/backend/package.json | dependencies |
| nodemon | 1.18.11 | cloud/backend/package.json | devDependencies |
| normalizr | 3.6.1 | cloud/app/package.json | dependencies |
| nx | ^17.0.0 | package.json | devDependencies |
| oauth2orize | 1.11.0 | cloud/backend/package.json | dependencies |
| onesignal-node | 2.0.1 | cloud/backend/package.json | dependencies |
| passport | 0.4.1 | cloud/backend/package.json | dependencies |
| passport | 0.5.0 | gateways/api/package.json | dependencies |
| passport-http-bearer | 1.0.1 | cloud/backend/package.json | dependencies |
| passport-jwt | 4.0.0 | cloud/backend/package.json | dependencies |
| passport-jwt | 4.0.0 | gateways/api/package.json | dependencies |
| passport-local | 1.0.0 | cloud/backend/package.json | dependencies |
| patch-package | 6.4.7 | cloud/app/package.json | devDependencies |
| pg | 8.13.1 | cloud/backend/package.json | dependencies |
| pg | ^8.16.3 | gateways/api/package.json | dependencies |
| postinstall-postinstall | 2.1.0 | cloud/app/package.json | devDependencies |
| prettier | ^3.0.0 | package.json | devDependencies |
| process | 0.11.10 | cloud/app/package.json | devDependencies |
| re-reselect | 4.0.0 | cloud/app/package.json | dependencies |
| react | 17.0.2 | cloud/app/package.json | dependencies |
| react-dom | 17.0.2 | cloud/app/package.json | dependencies |
| react-hook-form | 7.24.2 | cloud/app/package.json | dependencies |
| react-is | 17.0.2 | cloud/app/package.json | devDependencies |
| react-native | 0.66.3 | cloud/app/package.json | dependencies |
| react-native-date-picker | 3.4.0 | cloud/app/package.json | dependencies |
| react-native-draggable-grid | 2.1.3 | cloud/app/package.json | dependencies |
| react-native-flash-message | 0.1.24 | cloud/app/package.json | dependencies |
| react-native-gesture-handler | 1.8.0 | cloud/app/package.json | dependencies |
| react-native-image-picker | 4.0.6 | cloud/app/package.json | dependencies |
| react-native-localize | 2.1.4 | cloud/app/package.json | dependencies |
| react-native-masked-text | 1.13.0 | cloud/app/package.json | dependencies |
| react-native-onesignal | 4.3.9 | cloud/app/package.json | dependencies |
| react-native-safe-area-context | 3.3.2 | cloud/app/package.json | dependencies |
| react-native-screens | 3.8.0 | cloud/app/package.json | dependencies |
| react-native-style-utilities | 1.0.1 | cloud/app/package.json | dependencies |
| react-native-svg-app-icon | 0.2.0 | cloud/app/package.json | devDependencies |
| react-native-vector-icons | 7.1.0 | cloud/app/package.json | dependencies |
| react-native-web | 0.17.5 | cloud/app/package.json | dependencies |
| react-native-web-refresh-control | 1.1.0 | cloud/app/package.json | dependencies |
| react-native-webview | 11.6.6 | cloud/app/package.json | dependencies |
| react-navigation-header-buttons | 8.0.0 | cloud/app/package.json | dependencies |
| react-onesignal | 2.0.1 | cloud/app/package.json | dependencies |
| react-redux | 7.2.4 | cloud/app/package.json | dependencies |
| react-test-renderer | 17.0.2 | cloud/app/package.json | devDependencies |
| red-contrib-myio-modbus | ^3.0.1 | gateways/api/nodered_old/package.json | dependencies |
| redux | 4.1.1 | cloud/app/package.json | dependencies |
| redux-batched-actions | 0.5.0 | cloud/app/package.json | dependencies |
| redux-devtools-extension | 2.13.9 | cloud/app/package.json | dependencies |
| redux-persist | 6.0.0 | cloud/app/package.json | dependencies |
| redux-saga | 1.1.3 | cloud/app/package.json | dependencies |
| redux-saga-test-plan | 4.0.3 | cloud/app/package.json | devDependencies |
| reduxsauce | 1.2.1 | cloud/app/package.json | dependencies |
| request | 2.88.2 | cloud/backend/package.json | dependencies |
| request | ^2.88.2 | gateways/api/package.json | dependencies |
| request-promise | 4.2.5 | cloud/backend/package.json | dependencies |
| request-promise-native | 1.0.8 | cloud/backend/package.json | dependencies |
| reselect | 4.1.5 | cloud/app/package.json | dependencies |
| robodux | 11.0.3 | cloud/app/package.json | dependencies |
| sequelize | 6.37.5 | cloud/backend/package.json | dependencies |
| sequelize | 6.37.6 | gateways/api/package.json | dependencies |
| sequelize-cli | 6.6.2 | cloud/backend/package.json | dependencies |
| sequelize-cli | 6.6.2 | gateways/api/package.json | dependencies |
| sequelize-cursor-pagination | 2.3.0 | cloud/backend/package.json | dependencies |
| sequelize-mig | 2.4.1 | gateways/api/package.json | devDependencies |
| sinon | 4.1.6 | cloud/backend/package.json | devDependencies |
| source-map-support | 0.5.21 | cloud/app/package.json | devDependencies |
| standard | 14.3.4 | cloud/backend/package.json | devDependencies |
| standard | 14.3.4 | gateways/api/package.json | devDependencies |
| styled-components | 5.2.3 | cloud/app/package.json | dependencies |
| ts-jest | 26.4.4 | cloud/app/package.json | devDependencies |
| ts-node | 10.9.2 | cloud/app/package.json | devDependencies |
| tsc-files | 1.1.2 | cloud/app/package.json | devDependencies |
| tsx | ^4.19.0 | cloud/config-server/package.json | devDependencies |
| ttag | 1.7.24 | cloud/app/package.json | dependencies |
| ttag-cli | 1.9.3 | cloud/app/package.json | devDependencies |
| typed-redux-saga | 1.3.1 | cloud/app/package.json | dependencies |
| typescript | 4.3.5 | cloud/app/package.json | devDependencies |
| typescript | ^5.6.0 | cloud/config-server/package.json | devDependencies |
| typescript | ^5.2.0 | package.json | devDependencies |
| usehooks-ts | 2.2.1 | cloud/app/package.json | dependencies |
| uuid | 3.3.3 | cloud/backend/package.json | dependencies |
| uuid | ^10.0.0 | cloud/config-server/package.json | dependencies |
| webpack | 5.45.1 | cloud/app/package.json | devDependencies |
| webpack-dev-server | 4.0.0 | cloud/app/package.json | dependencies |
| ws | 7.1.2 | cloud/backend/package.json | dependencies |
| ws | ^8.18.0 | cloud/config-server/package.json | dependencies |
| ws | 3.3.3 | gateways/api/package.json | dependencies |
| ws | ^8.14.0 | gateways/erlradio/simulator/package.json | dependencies |
| ws | ^8.14.0 | gateways/erlradio/websocket_client/package.json | dependencies |
| yup | 0.32.11 | cloud/app/package.json | dependencies |
| zod | ^3.23.8 | cloud/config-server/package.json | dependencies |

### Manifest inventory: data-ingestion.git

| Package | Declared version | Manifest | Dependency group |
|---|---|---|---|
| @emotion/react | ^11.14.0 | energy-dashboard/package.json | dependencies |
| @emotion/styled | ^11.14.0 | energy-dashboard/package.json | dependencies |
| @eslint/js | ^9.25.0 | energy-dashboard/package.json | devDependencies |
| @headlessui/react | ^2.2.3 | energy-dashboard/package.json | dependencies |
| @mui/icons-material | ^7.1.0 | energy-dashboard/package.json | dependencies |
| @mui/material | ^7.1.0 | energy-dashboard/package.json | dependencies |
| @mui/x-date-pickers | ^8.4.0 | energy-dashboard/package.json | dependencies |
| @types/cors | ^2.8.18 | package.json | devDependencies |
| @types/express | ^5.0.1 | package.json | devDependencies |
| @types/jest | ^29.5.0 | infra/package.json | devDependencies |
| @types/moment | ^2.13.0 | package.json | dependencies |
| @types/morgan | ^1.9.9 | package.json | devDependencies |
| @types/node | 18.15.11 | infra/package.json | devDependencies |
| @types/node | ^22.15.18 | package.json | devDependencies |
| @types/pg | ^8.15.1 | package.json | devDependencies |
| @types/react | ^19.1.4 | energy-dashboard/package.json | devDependencies |
| @types/react-dom | ^19.1.2 | energy-dashboard/package.json | devDependencies |
| @types/uuid | ^10.0.0 | package.json | devDependencies |
| @vitejs/plugin-react | ^4.4.1 | energy-dashboard/package.json | devDependencies |
| aedes | ^0.51.3 | package.json | dependencies |
| autoprefixer | ^10.4.21 | energy-dashboard/package.json | dependencies |
| aws-cdk | ^2.130.0 | infra/package.json | devDependencies |
| aws-cdk-lib | ^2.130.0 | infra/package.json | dependencies |
| axios | ^1.9.0 | energy-dashboard/package.json | dependencies |
| axios | ^1.9.0 | package.json | dependencies |
| chart.js | ^4.4.9 | energy-dashboard/package.json | dependencies |
| chartjs-plugin-zoom | ^2.2.0 | energy-dashboard/package.json | dependencies |
| class-variance-authority | ^0.7.1 | energy-dashboard/package.json | dependencies |
| clsx | ^2.1.1 | energy-dashboard/package.json | dependencies |
| constructs | ^10.2.70 | infra/package.json | dependencies |
| cors | ^2.8.5 | package.json | dependencies |
| date-fns | ^4.1.0 | energy-dashboard/package.json | dependencies |
| date-fns-tz | ^3.2.0 | energy-dashboard/package.json | dependencies |
| dotenv | ^16.0.3 | infra/package.json | dependencies |
| dotenv | ^16.5.0 | package.json | dependencies |
| echarts | ^5.6.0 | energy-dashboard/package.json | dependencies |
| echarts-for-react | ^3.0.2 | energy-dashboard/package.json | dependencies |
| eslint | ^9.25.0 | energy-dashboard/package.json | devDependencies |
| eslint-plugin-react-hooks | ^5.2.0 | energy-dashboard/package.json | devDependencies |
| eslint-plugin-react-refresh | ^0.4.19 | energy-dashboard/package.json | devDependencies |
| express | ^5.1.0 | package.json | dependencies |
| globals | ^16.0.0 | energy-dashboard/package.json | devDependencies |
| html2canvas | ^1.4.1 | package.json | dependencies |
| jest | ^29.5.0 | infra/package.json | devDependencies |
| jspdf | ^3.0.1 | energy-dashboard/package.json | dependencies |
| jspdf | ^3.0.1 | package.json | dependencies |
| jspdf-autotable | ^5.0.2 | energy-dashboard/package.json | dependencies |
| lucide-react | ^0.511.0 | energy-dashboard/package.json | dependencies |
| moment | ^2.30.1 | package.json | dependencies |
| morgan | ^1.10.0 | package.json | dependencies |
| mqtt | ^5.13.0 | package.json | dependencies |
| pg | ^8.16.0 | package.json | dependencies |
| postcss | ^8.5.3 | energy-dashboard/package.json | dependencies |
| react | ^19.1.0 | energy-dashboard/package.json | dependencies |
| react-chartjs-2 | ^5.3.0 | energy-dashboard/package.json | dependencies |
| react-dom | ^19.1.0 | energy-dashboard/package.json | dependencies |
| react-router-dom | ^7.6.0 | energy-dashboard/package.json | dependencies |
| recharts | ^2.15.3 | energy-dashboard/package.json | dependencies |
| reflect-metadata | ^0.2.2 | package.json | dependencies |
| source-map-support | ^0.5.21 | infra/package.json | dependencies |
| tailwind-merge | ^3.3.0 | energy-dashboard/package.json | dependencies |
| tailwindcss | ^4.1.6 | energy-dashboard/package.json | dependencies |
| ts-jest | ^29.1.0 | infra/package.json | devDependencies |
| ts-node | ^10.9.1 | infra/package.json | devDependencies |
| ts-node | ^10.9.2 | package.json | dependencies |
| ts-node-dev | ^2.0.0 | package.json | devDependencies |
| tw-animate-css | ^1.3.0 | energy-dashboard/package.json | devDependencies |
| typeorm | ^0.3.23 | package.json | dependencies |
| typescript | ~5.8.3 | energy-dashboard/package.json | devDependencies |
| typescript | ~5.1.6 | infra/package.json | devDependencies |
| typescript | ^5.8.3 | package.json | devDependencies |
| typescript-eslint | ^8.30.1 | energy-dashboard/package.json | devDependencies |
| uuid | ^11.1.0 | package.json | dependencies |
| vite | ^6.3.5 | energy-dashboard/package.json | devDependencies |
| winston | ^3.17.0 | package.json | dependencies |



- Confirm the accountable security role and formal assignment.
- Confirm the existence and approval dates of security policies and the exception process.
- Confirm who performs independent audits and obtain suitable evidence.
- Confirm the formal risk register, review frequency, owners, and remediation tracking.
- Confirm which threat-intelligence sources and AWS security services are actively used.
- Confirm AWS data regions and whether backups, logs, and subprocessors meet sovereignty commitments.
- Ensure every **Yes** answer can be supported by documentation.
