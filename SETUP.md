# Opsætningsvejledning – Middelfart Udvalgsovervågning

## Overblik

Systemet består af fire dele:

| Del | Fil | Formål |
|-----|-----|--------|
| Hent-workflow | `n8n-workflow-hent.json` | Henter og AI-klassificerer dagsordenspunkter dagligt kl 05:00 |
| API-workflow | `n8n-workflow-api.json` | Webhook-endpoints som webappen kalder |
| Mail-workflow | `n8n-workflow-mail.json` | Ugentlig briefing-mail hver mandag kl 06:00 |
| Webapp | `index.html` | Dashboard med briefingkort og check-in |

## Trin 1: Google Sheets

1. Opret et nyt Google Sheet med navnet **"Middelfart Udvalgsovervågning"**
2. Omdøb det første ark til **"Sager"**
3. Tilføj disse kolonneoverskrifter i række 1:

```
id | møde_id | udvalg | møde_dato | punkt_nr | titel | kategori | relevans_score | resumé | relevans_begrundelse | foreslaaet_handling | status | vores_input | vores_vinkel | tjekket_ind_af | tjekket_ind_dato | kilde_url | oprettet
```

4. Notér Sheet-ID'et fra URL'en (den lange streng mellem `/d/` og `/edit`):
   `https://docs.google.com/spreadsheets/d/DETTE_ER_DIT_SHEET_ID/edit`

## Trin 2: n8n Credentials

Log ind på din n8n Cloud-instans og opret disse credentials:

### Google Sheets (OAuth2)
1. Gå til **Settings → Credentials → Add Credential**
2. Vælg **Google Sheets (OAuth2)**
3. Følg OAuth-flowet for at give n8n adgang til dit Google Sheet
4. Notér credential-navnet (fx "Google Sheets")

### Anthropic API
1. Gå til **Settings → Credentials → Add Credential**
2. Vælg **Header Auth** (da n8n måske ikke har en dedikeret Anthropic-credential)
3. Sæt:
   - **Name**: `x-api-key`
   - **Value**: Din Anthropic API-nøgle (`sk-ant-...`)
4. Navngiv credentialen "Anthropic API"

### Gmail (til ugentlig briefing)
1. Gå til **Settings → Credentials → Add Credential**
2. Vælg **Gmail OAuth2**
3. Følg OAuth-flowet
4. Alternativt: Brug SMTP-node med Gmail app-password

## Trin 3: Importér Workflows

For hver af de tre workflow-filer:

1. Gå til **Workflows → Add Workflow → Import from File**
2. Upload JSON-filen
3. **VIGTIGT**: Erstat placeholder-værdier i alle nodes:
   - `GOOGLE_SHEET_ID_HER` → dit faktiske Google Sheet-ID
   - `GOOGLE_CREDENTIAL_ID` → vælg din Google Sheets credential
   - `ANTHROPIC_CREDENTIAL_ID` → vælg din Anthropic API credential
   - `GMAIL_CREDENTIAL_ID` → vælg din Gmail credential (kun i mail-workflow)
4. Gem workflowet

### Rækkefølge for import:
1. Først: `n8n-workflow-hent.json` (Hent Dagsordener)
2. Derefter: `n8n-workflow-api.json` (Udvalgs-API)
3. Til sidst: `n8n-workflow-mail.json` (Ugentlig Briefing)

## Trin 4: Test Hent-Workflow

1. Åbn "Middelfart – Hent Dagsordener" i n8n
2. Klik **Execute Workflow** (manuel kørsel)
3. Tjek at:
   - "Kendte Udvalg & Møder" producerer items
   - "Hent Dagsorden" modtager data fra Middelfarts API
   - "Claude AI Klassificering" returnerer klassificerede punkter
   - "Gem i Google Sheets" skriver rækker i dit Sheet
4. Åbn Google Sheet og verificér at data er kommet ind

### Fejlfinding:
- **CORS/Network-fejl**: Bør ikke opstå i n8n (kun i browsere)
- **API timeout**: Middelfarts API kan være langsom – timeout er sat til 30 sek
- **Claude-fejl**: Tjek at API-nøglen er korrekt og har kredit
- **Sheets-fejl**: Tjek at credential har adgang til det specifikke sheet

## Trin 5: Test API-Workflow

1. Åbn "Middelfart – Udvalgs-API" i n8n
2. **Aktivér workflowet** (det skal køre for at webhooks virker)
3. Find dine webhook-URLs:
   - Klik på "Webhook: Hent Sager" noden
   - Kopiér **Production URL** (den der IKKE indeholder `/test/`)
   - Mønster: `https://din-instans.app.n8n.cloud/webhook/sager`
4. Test i browseren: åbn webhook-URL'en → du bør se JSON med sager
5. Notér base-URL'en (alt før `/sager`)

## Trin 6: Konfigurér Webapp

1. Åbn `index.html` i en editor
2. Find linjen (nær toppen):
   ```javascript
   const N8N_BASE_URL = 'https://DIN-INSTANS.app.n8n.cloud/webhook';
   ```
3. Erstat med din faktiske webhook-URL fra Trin 5
4. Gem filen
5. Åbn `index.html` i en browser
6. Klik "Opdatér" → sager fra Google Sheets bør vises
7. Test check-in: klik "Tjek ind" på en sag, tilføj data, gem

## Trin 7: Test Briefing Mail

1. Åbn "Middelfart – Ugentlig Briefing" i n8n
2. Klik **Execute Workflow** (manuel kørsel)
3. Tjek at mailen modtages på henrik@visitmiddelfart.dk
4. Hvis ingen sager med score ≥ 3 findes, sendes ingen mail

## Trin 8: Aktivér Schedules

Når alt virker:

1. **Hent Dagsordener**: Aktivér → kører dagligt kl 05:00
2. **Udvalgs-API**: Aktivér → webhooks er tilgængelige
3. **Ugentlig Briefing**: Aktivér → mail sendes mandag kl 06:00

## Tilføj nye møder

Når nye møder offentliggøres:

1. Åbn "Middelfart – Hent Dagsordener" i n8n
2. Rediger "Kendte Udvalg & Møder" code-noden
3. Tilføj nye møde-IDer til den relevante committee's `meetings` array
4. Møde-IDer finder du på `https://dagsordener.middelfart.dk`

## Næste skridt (fremtidige forbedringer)

- **Automatisk møde-discovery**: Scrape `dagsordener.middelfart.dk` for nye møder i stedet for manuelle IDer
- **Flere kommuner**: Tilføj nabokommuner eller Region Syddanmark
- **PDF-parsing**: Hent og analysér vedhæftede dokumenter
- **Notifikationer**: Slack/Teams-besked ved nye højt-relevante sager
- **Database**: Migrer fra Google Sheets til en rigtig database (Supabase, Airtable)
