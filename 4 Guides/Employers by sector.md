# Employers by sector

An **optional** starter list of 323 employers in 15 sectors. Use it if you want ideas for where to look; ignore it if you already know your target employers.

- **Nothing here is loaded automatically.** Your employer list starts empty until you choose to import some or all of these sectors.
- **Canada- and Toronto-weighted.** Most employers have Toronto/GTA or Canadian offices, or hire for Canada-eligible remote roles. If you live elsewhere, treat it as an example of how to build your own list.
- **Checked on 2026-11-25.** Every careers link was checked on that date, and links that refused the automated check were spot-checked again. A few large sites block automated tools but open normally in a browser. Careers sites move, so if a link breaks, search the web for the employer name plus the word careers.
- **Not an endorsement.** Being on this list says nothing about whether an employer is hiring now or is a good fit for you.

## How to import it

Pick the sectors you care about, then **ask your assistant** (Codex or Claude), for example:

> Add the starter employers for Pharmaceutical companies and Hospitals & research institutes.

You can name sectors by their heading below or by their import id. To take everything, ask it to add all the starter employers. (The dashboard only displays your list; your assistant does the adding.)

For assistants: run `node app/cli.mjs employers import-guide --sectors pharma,hospitals-institutes`, or leave out `--sectors` to import every sector.

Importing is safe to repeat: employers already in your list are skipped, not duplicated. After importing you can change any employer's details, priority or notes, but there is no bulk undo, so import only the sectors you will actually use.

## Reading the tables

- **Careers page** is where the employer posts its own openings. Always apply from the employer's own posting. "Homepage" or "Team page" means no separate careers page was found; see the notes.
- **Platform** is the hiring system behind the careers page, as detected on the check date. "Company site" means the employer runs its own careers page or no hiring system could be identified (it may still hand you off to one when you click Apply). See [Where jobs are posted](Where%20jobs%20are%20posted.md) for what each platform means for you.
- **Where** is a rough location: "Toronto/GTA", "Canada", "Canada-eligible remote", or a reminder to check each posting. Always confirm the location and work-permit requirements in the posting itself.

## Sectors

- [Pharmaceutical companies](#pharmaceutical-companies) (38), import id `pharma`
- [Biotech & therapeutics startups](#biotech--therapeutics-startups) (28), import id `biotech`
- [Hospitals & research institutes](#hospitals--research-institutes) (13), import id `hospitals-institutes`
- [Universities & colleges](#universities--colleges) (6), import id `universities`
- [Clinical research, CROs & testing labs](#clinical-research-cros--testing-labs) (17), import id `clinical-research`
- [Scientific instruments & lab tools](#scientific-instruments--lab-tools) (21), import id `lab-tools`
- [Medical devices & diagnostics](#medical-devices--diagnostics) (7), import id `medtech`
- [Health tech & life-science software](#health-tech--life-science-software) (14), import id `health-tech`
- [Medical communications, HEOR & life-science consulting](#medical-communications-heor--life-science-consulting) (23), import id `medcomms-consulting`
- [Consulting & market research](#consulting--market-research) (15), import id `consulting-research`
- [AI & large technology companies](#ai--large-technology-companies) (26), import id `ai-tech`
- [Software & SaaS companies](#software--saas-companies) (50), import id `software-saas`
- [Banks, fintech & commerce](#banks-fintech--commerce) (43), import id `finance`
- [Government & public agencies](#government--public-agencies) (3), import id `public-sector`
- [Non-profits, charities & research funders](#non-profits-charities--research-funders) (19), import id `nonprofits-funders`

## Pharmaceutical companies

Established drug makers with Canadian offices (medical affairs, regulatory, market access, commercial).

Typical roles: Medical science liaison, Medical information specialist, Regulatory affairs associate, Clinical research associate, Market access / HEOR analyst, Pharmacovigilance associate.

Import id: `pharma`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [AbbVie Canada](https://www.abbvie.ca/en/) | [Careers](https://careers.abbvie.com/) | Company site | Canada |  |
| [Alexion (AstraZeneca Rare Disease)](https://alexion.com/) | [Careers](https://careers.astrazeneca.com/) | Company site | Toronto/GTA | Openings are listed on the AstraZeneca careers site; filter by this company's name. |
| [Amgen Canada](https://www.amgen.ca/) | [Careers](https://careers.amgen.com/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Apotex](https://www.apotex.com/ca) | [Careers](https://careers.apotex.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Astellas Pharma Canada](https://www.astellas.com/en/) | [Careers](https://www.astellas.com/en/careers) | Company site | Toronto/GTA |  |
| [AstraZeneca](https://www.astrazeneca.com/) | [Careers](https://careers.astrazeneca.com/canada) | Company site | Toronto/GTA |  |
| [Bausch Health Canada](https://bauschhealth.ca/) | [Careers](https://careers.bauschhealth.com/) | SuccessFactors | Canada | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Bayer](https://www.bayer.com/en/ca/canada) | [Careers](https://www.bayer.com/en/career) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Biogen Canada](https://www.biogen.ca/en-ca/) | [Careers](https://www.biogen.ca/en-ca/careers.html) | Company site | Toronto/GTA |  |
| [BioSyent](https://www.biosyent.com/) | [Careers](https://www.biosyent.com/careers/) | Company site | Toronto/GTA |  |
| [Boehringer Ingelheim Canada](https://www.boehringer-ingelheim.com/ca) | [Careers](https://www.boehringer-ingelheim.com/careers) | Company site | Toronto/GTA |  |
| [Bristol Myers Squibb Canada](https://www.bms.com/ca/en/) | [Careers](https://careers.bms.com/) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Chiesi Canada](https://www.chiesi.ca/) | [Careers](https://careers.chiesi.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Eisai Canada](https://ca.eisai.com/en-CA) | [Careers](https://careers.eisai.com/) | Company site | Toronto/GTA |  |
| [Eli Lilly Canada](https://www.lilly.com/en-ca) | [Careers](https://careers.lilly.com/us/en) | Company site | Toronto/GTA |  |
| [EMD Serono / Merck KGaA](https://www.emdserono.ca/ca-en/) | [Careers](https://careers.emdgroup.com/) | Company site | Toronto/GTA |  |
| [Gilead Sciences Canada](https://www.gilead.com/en-ca) | [Careers](https://www.gilead.com/en-ca/careers) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Grifols Canada](https://www.grifols.ca/) | [Careers](https://www.grifols.com/en/careers) | Company site | Toronto/GTA |  |
| [GSK](https://ca.gsk.com/en-ca/) | [Careers](https://ca.gsk.com/en-ca/careers/) | Company site | Toronto/GTA |  |
| [Ipsen Canada](https://www.ipsen.com/canada/) | [Careers](https://careers.ipsen.com/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Jazz Pharmaceuticals Canada](https://www.jazzpharma.com/) | [Careers](https://careers.jazzpharma.com/jobs/ca-on-mississauga/) | Company site | Toronto/GTA |  |
| [Johnson & Johnson Innovative Medicine / Janssen](https://www.jnj.com/innovativemedicine/canada) | [Careers](https://www.careers.jnj.com/en/locations/north-america/canada/) | Company site | Toronto/GTA |  |
| [Lundbeck Canada](https://www.lundbeck.com/ca/en) | [Careers](https://jobs.lundbeck/) | SuccessFactors | Canada | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Merck Canada / MSD](https://www.merck.ca/en/) | [Careers](https://jobs.merck.com/us/en/mrl-canada) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Novartis](https://www.novartis.com/ca-en/) | [Careers](https://www.novartis.com/careers) | Company site | Toronto/GTA |  |
| [Novo Nordisk Canada](https://www.novonordisk.ca/) | [Careers](https://www.novonordisk.com/careers.html) | Company site | Toronto/GTA |  |
| [Organon Canada](https://www.organon.com/canada-en/) | [Careers](https://jobs.organon.com/) | Company site | Canada |  |
| [Otsuka Canada](https://otsukacanada.com/) | [Careers](https://otsukacanada.com/careers/) | Company site | Canada |  |
| [Pfizer Canada](https://www.pfizer.ca/en) | [Careers](https://www.pfizer.com/about/careers) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Recordati Rare Diseases Canada](https://recordatirarediseases.com/) | [Careers](https://careers.recordati.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. This is the Recordati group careers site; filter by Canada. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Regeneron Canada](https://www.regeneron.com/) | [Careers](https://careers.regeneron.com/en/jobs/?country=Canada&location=Mississauga) | Company site | Toronto/GTA |  |
| [Roche](https://www.rochecanada.com/) | [Careers](https://careers.roche.com/global/en/mississauga) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Sanofi](https://www.sanofi.com/) | [Careers](https://jobs.sanofi.com/en/canada) | Company site | Toronto/GTA |  |
| [Servier Canada](https://servier.ca/en/) | [Careers](https://jobs.servier.com/) | SuccessFactors | Canada | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Sobi Canada](https://www.sobi.com/canada/en) | [Careers](https://www.sobi.com/en/careers) | Company site | Toronto/GTA |  |
| [Takeda Canada](https://www.takeda.com/en-ca/) | [Careers](https://www.takedajobs.com/) | Company site | Toronto/GTA |  |
| [Teva Canada](https://www.tevacanada.com/) | [Careers](https://www.careers.teva/careers) | Company site | Toronto/GTA |  |
| [UCB Canada](https://www.ucb-canada.ca/) | [Careers](https://careers.ucb.com/) | Company site | Toronto/GTA |  |

## Biotech & therapeutics startups

Smaller drug, cell-therapy, gene-therapy and ag-biotech companies, often research-stage.

Typical roles: Research scientist, Research associate, Scientist, assay development, Project / alliance manager, Business development associate.

Import id: `biotech`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [AbCellera](https://www.abcellera.com/) | [Careers](https://www.abcellera.com/current-openings) | Greenhouse | Canada | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Acuitas Therapeutics](https://acuitastx.com/) | [Careers](https://acuitastx.com/careers/) | Company site | Canada |  |
| [Allarta Life Science](https://allarta.com/) | [Careers](https://allarta.com/careers/) | Company site | Canada |  |
| [Aptose Biosciences](https://www.aptose.com/) | [Careers](https://www.aptose.com/careers) | BambooHR | Check each posting for Canadian locations | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Arch Biopartners](https://archbiopartners.com/) | [Homepage](https://archbiopartners.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Aspect Biosystems](https://www.aspectbiosystems.com/) | [Careers](https://aspectbiosystems.com/careers) | Greenhouse | Canada | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Avicanna](https://avicanna.com/) | [Homepage](https://avicanna.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [BlueRock Therapeutics](https://www.bluerocktx.com/) | [Careers](https://www.bluerocktx.com/become-a-bluerocker/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Deep Genomics](https://www.deepgenomics.com/) | [Careers](https://www.deepgenomics.com/careers) | Lever | Toronto/GTA | This careers page hands you off to the employer's Lever job site. Lever: no account needed; you apply to each posting with a form. |
| [Evolve Biologics](https://www.evolvebiologics.com/) | [Careers](https://www.evolvebiologics.com/careers/) | Company site | Toronto/GTA |  |
| [Fusion Pharmaceuticals (AstraZeneca)](https://fusionpharma.com/) | [Careers](https://fusionpharma.com/careers/) | Company site | Canada |  |
| [Intrepid Labs](https://www.intrepidlabs.tech/) | [Homepage](https://www.intrepidlabs.tech/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Medicenna Therapeutics](https://www.medicenna.com/) | [Careers](https://www.medicenna.com/careers) | Company site | Toronto/GTA |  |
| [Mediphage Bioceuticals](https://www.mediphage.ca/) | [Homepage](https://www.mediphage.ca/) | Company site | Check each posting for Canadian locations | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Molagri](https://molagri.com/) | [Careers](https://molagri.com/careers/) | Company site | Toronto/GTA |  |
| [Noa Therapeutics](https://noatherapeutics.com/) | [Homepage](https://noatherapeutics.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [OmniaBio](https://omniabio.com/) | [Careers](https://omniabio.com/careers/) | Jobvite | Toronto/GTA | This careers page hands you off to the employer's Jobvite job site. Jobvite: usually no account needed; you apply to each posting with a form. |
| [POINT Biopharma (Lilly)](https://www.lilly.com/) | [Careers](https://careers.lilly.com/us/en) | Company site | Check each posting for Canadian locations | Openings are listed on the Eli Lilly careers site; filter by this company's name. |
| [Providence Therapeutics](https://providencetherapeutics.com/) | [Careers](https://providencetherapeutics.com/careers-page/careers.html) | Company site | Toronto/GTA |  |
| [Radiant Biotherapeutics](https://www.radiantbio.com/) | [Homepage](https://www.radiantbio.com/) | Company site | Check each posting for Canadian locations | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Recursion](https://recursion.com/) | [Careers](https://recursion.com/careers) | Greenhouse | Check each posting for Canadian locations | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Satellos Bioscience](https://satellos.com/) | [Careers](https://satellos.com/careers/) | Company site | Toronto/GTA |  |
| [Specific Biologics](https://www.specificbiologics.com/) | [Homepage](https://www.specificbiologics.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Treadwell Therapeutics](https://treadwelltx.com/) | [Careers](https://treadwelltx.com/careers/) | Greenhouse | Check each posting for Canadian locations | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Triumvira Immunologics](https://triumvira.com/) | [Homepage](https://triumvira.com/) | Company site | Check each posting for Canadian locations | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Vasomune Therapeutics](https://vasomune.com/) | [Careers](https://vasomune.com/about-us/careers/) | Company site | Toronto/GTA |  |
| [Vive Crop Protection](https://www.vivecrop.com/) | [Careers](https://www.vivecrop.com/careers) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Zucara Therapeutics](https://www.zucara.ca/) | [Homepage](https://www.zucara.ca/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |

## Hospitals & research institutes

Research hospitals and independent research institutes, mostly publicly funded.

Typical roles: Research associate, Research coordinator, Clinical research coordinator, Grants / research development officer, Data analyst, Lab manager.

Import id: `hospitals-institutes`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Baycrest — Rotman Research Institute](https://www.baycrest.org/) | [Careers](https://www.baycrest.org/careers-at-baycrest/) | Company site | Toronto/GTA |  |
| [Centre for Addiction and Mental Health (CAMH)](https://www.camh.ca/) | [Careers](https://iaemup.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CAMH/jobs) | Oracle Recruiting | Toronto/GTA | Oracle Recruiting: you usually sign in for each employer with your email and a one-time code. |
| [Holland Bloorview Kids Rehabilitation Hospital — Bloorview Research Institute](https://hollandbloorview.ca/) | [Careers](https://research.hollandbloorview.ca/about-us/working-with-us) | Company site | Toronto/GTA |  |
| [ICES](https://www.ices.on.ca/) | [Careers](https://www.ices.on.ca/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Kensington Health — Research Institute](https://www.kensingtonhealth.org/) | [Careers](https://careers.kensingtonhealth.org/) | Company site | Toronto/GTA |  |
| [Ontario Institute for Cancer Research (OICR)](https://oicr.on.ca/) | [Careers](https://oicr.on.ca/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Sinai Health — Lunenfeld-Tanenbaum Research Institute](https://www.sinaihealth.ca/) | [Careers](https://www.sinaihealth.ca/careers-at-sinai-health/research-jobs) | Company site | Toronto/GTA |  |
| [Sunnybrook Health Sciences Centre — Sunnybrook Research Institute](https://sunnybrook.ca/) | [Careers](https://research.sunnybrook.ca/careers-and-students/) | Company site | Toronto/GTA |  |
| [The Hospital for Sick Children (SickKids)](https://www.sickkids.ca/) | [Careers](https://www.sickkids.ca/en/careers-volunteer/careers/) | Company site | Toronto/GTA |  |
| [Unity Health Toronto](https://unityhealth.to/) | [Careers](https://research.unityhealth.to/resources/research-employment/) | Company site | Toronto/GTA |  |
| [University Health Network](https://www.uhn.ca/) | [Careers](https://careers.smartrecruiters.com/UniversityHealthNetwork) | SmartRecruiters | Toronto/GTA | SmartRecruiters: you can apply as a guest; an account lets you reuse your profile. |
| [Vector Institute](https://vectorinstitute.ai/) | [Careers](https://vectorinstitute.ai/about/careers/open-positions/) | Company site | Toronto/GTA |  |
| [Women’s College Hospital — Research and Innovation Institute](https://www.womenscollegehospital.ca/) | [Careers](https://www.womensacademics.ca/careers/) | Company site | Toronto/GTA |  |

## Universities & colleges

University staff, research and academic positions (staff jobs and faculty jobs are often posted separately).

Typical roles: Research associate, Postdoctoral fellow, Research grants officer, Lab manager, Program coordinator, Lecturer / faculty.

Import id: `universities`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [McMaster University](https://www.mcmaster.ca/) | [Careers](https://hr.mcmaster.ca/careers/) | Company site | Canada |  |
| [Ontario Tech University](https://ontariotechu.ca/) | [Careers](https://hr.ontariotechu.ca/working-at-ontario-tech/careers/index.php) | Company site | Toronto/GTA |  |
| [Toronto Metropolitan University](https://www.torontomu.ca/) | [Careers](https://www.torontomu.ca/careers/) | Company site | Toronto/GTA |  |
| [University of Toronto](https://www.utoronto.ca/) | [Careers](https://jobs.utoronto.ca/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [University of Waterloo](https://uwaterloo.ca/) | [Careers](https://uwaterloo.ca/careers/) | Company site | Canada |  |
| [York University](https://www.yorku.ca/) | [Careers](https://www.yorku.ca/jobs/) | Technomedia | Toronto/GTA | This careers page hands you off to the employer's Technomedia job site. |

## Clinical research, CROs & testing labs

Contract research organizations, early-phase clinics, preclinical and analytical testing labs.

Typical roles: Clinical research associate (CRA), Clinical trial assistant, Study start-up specialist, Project manager, Regulatory / quality specialist, Laboratory analyst.

Import id: `clinical-research`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Alimentiv](https://alimentiv.com/) | [Careers](https://jobs.lever.co/alimentiv-2/) | Lever | Toronto/GTA | Lever: no account needed; you apply to each posting with a form. |
| [Altasciences](https://www.altasciences.com/) | [Careers](https://canada.altasciences.com/careers) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [BioPharma Services](https://biopharmaservices.com/) | [Careers](https://biopharmaservices.com/careers/) | Company site | Toronto/GTA |  |
| [CellCarta](https://cellcarta.com/) | [Careers](https://cellcarta.com/careers/) | Company site | Canada |  |
| [Charles River Laboratories](https://www.criver.com/) | [Careers](https://careers.criver.com/go/Voir-tous-les-emplois-%28fr_CA%29/3657800/) | SuccessFactors | Canada | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [dicentra](https://dicentra.com/) | [Careers](https://dicentra.com/careers/open-opportunities) | Company site | Toronto/GTA |  |
| [Dynacare (Labcorp)](https://www.dynacare.ca/) | [Careers](https://www.dynacare.ca/careers/dynacare-careers.aspx) | Jobvite | Toronto/GTA | This careers page hands you off to the employer's Jobvite job site. Jobvite: usually no account needed; you apply to each posting with a form. |
| [Eurofins Scientific](https://www.eurofins.ca/en/) | [Careers](https://jobs.smartrecruiters.com/Eurofins) | SmartRecruiters | Toronto/GTA | SmartRecruiters: you can apply as a guest; an account lets you reuse your profile. |
| [Fortrea](https://www.fortrea.com/) | [Careers](https://fortrea.wd1.myworkdayjobs.com/en-US/Fortrea) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [ICON plc](https://www.iconplc.com/) | [Careers](https://careers.iconplc.com/jobs-in-canada) | Company site | Toronto/GTA |  |
| [Intertek](https://www.intertek.com/) | [Careers](https://www.intertek.com/careers/) | Oracle Recruiting | Toronto/GTA | This careers page hands you off to the employer's Oracle Recruiting job site. Oracle Recruiting: you usually sign in for each employer with your email and a one-time code. |
| [IQVIA](https://www.iqvia.com/) | [Careers](https://jobs.iqvia.com/en) | Company site | Toronto/GTA |  |
| [Medpace](https://www.medpace.com/) | [Careers](https://www.medpace.com/careers/) | iCIMS | Check each posting for Canadian locations | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Parexel](https://www.parexel.com/) | [Careers](https://jobs.parexel.com/en) | Company site | Check each posting for Canadian locations |  |
| [Pharma Medica Research](https://www.pharmamedica.com/) | [Careers](https://pharma-medica-research-inc.breezy.hr/) | Breezy HR | Toronto/GTA | Breezy HR: no account needed; you apply to each posting with a form. |
| [SGS Canada](https://www.sgs.com/en-ca) | [Careers](https://www.sgs.com/en-ca/our-company/careers-at-sgs/job-opportunities) | Company site | Toronto/GTA |  |
| [Syneos Health](https://www.syneoshealth.com/) | [Careers](https://www.syneoshealth.com/careers) | Company site | Toronto/GTA |  |

## Scientific instruments & lab tools

Instruments, reagents, genomics and bioprocess tools used by labs.

Typical roles: Field application scientist, Technical support scientist, Product specialist, Account manager, Product manager, Scientific marketing.

Import id: `lab-tools`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Agilent Technologies](https://www.agilent.com/) | [Careers](https://careers.agilent.com/locations/americas/canada/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Beckman Coulter](https://www.beckman.com/) | [Careers](https://jobs.danaher.com/global/en) | Company site | Toronto/GTA | Openings are listed on the Danaher careers site; filter by this company's name. |
| [Bio-Rad Laboratories](https://www.bio-rad.com/) | [Careers](https://careers.bio-rad.com/homepage) | Company site | Check each posting for Canadian locations |  |
| [Bio-Techne](https://www.bio-techne.com/) | [Careers](https://www.bio-techne.com/about/careers) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Bruker](https://www.bruker.com/) | [Careers](https://www.bruker.com/en/careers.html) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Cedarlane](https://www.cedarlanelabs.com/) | [Homepage](https://www.cedarlanelabs.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Cytiva](https://www.cytivalifesciences.com/) | [Careers](https://jobs.danaher.com/global/en) | Company site | Canada | Openings are listed on the Danaher careers site; filter by this company's name. |
| [Danaher](https://www.danaher.com/) | [Careers](https://danaher.wd1.myworkdayjobs.com/DanaherJobs) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [DMark Biosciences](https://dmarkbio.com/) | [Homepage](https://dmarkbio.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Eppendorf Canada](https://www.eppendorf.com/ca-en/) | [Careers](https://www.eppendorf.com/ca-en/company-careers/) | Company site | Toronto/GTA |  |
| [Illumina](https://www.illumina.com/) | [Careers](https://www.illumina.com/company/careers.html) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Leica Biosystems](https://www.leicabiosystems.com/) | [Careers](https://danaher.wd1.myworkdayjobs.com/DanaherJobs) | Workday | Toronto/GTA | Openings are listed on the Danaher careers site; filter by this company's name. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [LGC Group / Toronto Research Chemicals](https://www.lgcgroup.com/) | [Careers](https://careers.smartrecruiters.com/lgcgroup) | SmartRecruiters | Toronto/GTA | SmartRecruiters: you can apply as a guest; an account lets you reuse your profile. |
| [QIAGEN](https://www.qiagen.com/) | [Careers](https://www.qiagen.com/us/careers) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Revvity](https://www.revvity.com/) | [Careers](https://jobs.revvity.com/search-jobs) | Company site | Canada |  |
| [Sartorius](https://www.sartorius.com/) | [Careers](https://www.sartorius.com/en/company/careers/vacancies-job-opportunities) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [SCIEX](https://sciex.com/) | [Careers](https://jobs.danaher.com/global/en) | Company site | Toronto/GTA | Openings are listed on the Danaher careers site; filter by this company's name. |
| [STEMCELL Technologies](https://www.stemcell.com/) | [Careers](https://jobs.stemcell.com/) | Company site | Canada |  |
| [Thermo Fisher Scientific](https://www.thermofisher.com/) | [Careers](https://jobs.thermofisher.com/global/en/canada-jobs/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Waters Corporation](https://www.waters.com/) | [Careers](https://www.waters.com/nextgen/us/en/about-waters/careers.html) | iCIMS | Check each posting for Canadian locations | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [ZEISS Group](https://www.zeiss.ca/) | [Careers](https://zeissgroup.wd3.myworkdayjobs.com/en-US/External) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |

## Medical devices & diagnostics

Medical device, imaging and diagnostic companies.

Typical roles: Clinical specialist, Regulatory affairs specialist, Field service / application specialist, Territory sales representative, Quality engineer.

Import id: `medtech`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Abbott](https://www.abbott.com/) | [Careers](https://abbott.wd5.myworkdayjobs.com/abbottcareers) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Adela](https://www.adelabio.com/) | [Careers](https://www.adelabio.com/adela-careers) | Company site | Toronto/GTA |  |
| [Becton Dickinson](https://www.bd.com/) | [Careers](https://jobs.bd.com/en/search-jobs/Canada) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [GE HealthCare](https://www.gehealthcare.com/) | [Careers](https://careers.gehealthcare.com/global/en) | Company site | Canada-eligible remote |  |
| [Medtronic](https://www.medtronic.com/) | [Careers](https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Siemens Healthineers](https://www.siemens-healthineers.com/) | [Careers](https://careers.siemens-healthineers.com/global/en/search-results?keywords=Canada) | Company site | Toronto/GTA |  |
| [Stryker](https://www.stryker.com/) | [Careers](https://stryker.wd1.myworkdayjobs.com/StrykerCareers) | Workday | Canada | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |

## Health tech & life-science software

Software and services for health systems, clinical trials and life-science R&D.

Typical roles: Customer success manager, Implementation specialist, Solutions consultant, Product manager, Clinical / scientific data analyst.

Import id: `health-tech`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [AlayaCare](https://alayacare.com/) | [Careers](https://alayacare.com/ca/careers/) | Company site | Toronto/GTA |  |
| [Benchling](https://www.benchling.com/) | [Careers](https://www.benchling.com/careers) | Ashby | Check each posting for Canadian locations | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [BenchSci](https://www.benchsci.com/) | [Careers](https://www.benchsci.com/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Certara](https://www.certara.com/) | [Careers](https://careers.certara.com/) | iCIMS | Canada | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [DNAstack](https://dnastack.com/) | [Careers](https://dnastack.com/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [League](https://league.com/) | [Careers](https://league.com/careers) | Company site | Toronto/GTA |  |
| [Maple](https://www.getmaple.ca/) | [Careers](https://www.getmaple.ca/careers/) | Lever | Toronto/GTA | This careers page hands you off to the employer's Lever job site. Lever: no account needed; you apply to each posting with a form. |
| [McKesson Canada](https://www.mckesson.ca/) | [Careers](https://careers.mckesson.com/en) | Company site | Toronto/GTA |  |
| [Medidata](https://www.medidata.com/) | [Careers](https://www.medidata.com/en/careers/job-search/) | Company site | Check each posting for Canadian locations |  |
| [PhenoTips](https://phenotips.com/) | [Team page](https://phenotips.com/team/) | Company site | Toronto/GTA | No careers page; the Team page lists an email contact for hiring enquiries. |
| [PointClickCare](https://pointclickcare.com/) | [Careers](https://jobs.lever.co/pointclickcare) | Lever | Toronto/GTA | Lever: no account needed; you apply to each posting with a form. |
| [SciLeads](https://scileads.com/) | [Careers](https://job-boards.greenhouse.io/scileads) | Greenhouse | Canada-eligible remote | Greenhouse: no account needed; you apply to each posting with a form. |
| [UnitedHealth Group / Optum Canada](https://www.unitedhealthgroup.com/) | [Careers](https://careers.unitedhealthgroup.com/location/canada-jobs/34088/6251999/2) | Taleo | Canada-eligible remote | This careers page hands you off to the employer's Taleo job site. Taleo: use Apply as Guest if offered; otherwise create an account for this employer. |
| [Veeva Systems](https://www.veeva.com/) | [Careers](https://careers.veeva.com/) | Company site | Toronto/GTA |  |

## Medical communications, HEOR & life-science consulting

Agencies and consultancies serving pharma: medical writing, health economics and outcomes research (HEOR), market access, commercial strategy.

Typical roles: Medical writer, Scientific / medical editor, HEOR / evidence synthesis analyst, Market access consultant, Account manager, Associate consultant.

Import id: `medcomms-consulting`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Analysis Group](https://www.analysisgroup.com/) | [Careers](https://www.analysisgroup.com/careers/) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Avalere Health](https://avalerehealth.com/) | [Careers](https://avalerehealth.com/careers/) | Company site | Canada |  |
| [AXON Communications](https://axon-com.com/) | [Careers](https://axon-com.com/join-us/) | Greenhouse | Toronto/GTA | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [AXS Studio](https://axs3d.com/) | [Careers](https://axs3d.com/careers/) | Company site | Toronto/GTA |  |
| [BGBx](https://bgbx.com/) | [Careers](https://bgbx.com/careers/) | Greenhouse | Canada | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [EVERSANA](https://www.eversana.com/) | [Careers](https://www.eversana.com/careers/) | Company site | Toronto/GTA |  |
| [Inizio](https://inizio.com/) | [Careers](https://inizio.com/join-inizio/) | Greenhouse | Canada | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Innomar Strategies (Cencora)](https://www.cencora.com/) | [Careers](https://myhrabc.wd5.myworkdayjobs.com/Global) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Intrinsik](https://intrinsik.com/) | [Careers](https://intrinsik.com/careers/) | Company site | Toronto/GTA |  |
| [Klick](https://www.klick.com/) | [Careers](https://careers.klick.com/) | Company site | Toronto/GTA |  |
| [Lumanity](https://lumanity.com/) | [Careers](https://lumanity.com/careers/current-openings/) | Company site | Check each posting for Canadian locations |  |
| [Medlior Health Outcomes Research](https://www.medlior.com/) | [Careers](https://www.medlior.com/careers/) | Company site | Canada-eligible remote |  |
| [MEDUCOM Health](https://www.meducom.ca/) | [Careers](https://www.meducom.ca/careers) | Company site | Canada |  |
| [MORSE Consulting](https://morseconsulting.ca/) | [Careers](https://morseconsulting.ca/careers/) | Company site | Check each posting for Canadian locations |  |
| [Ogilvy Health Canada](https://www.ogilvy.com/) | [Careers](https://job-boards.greenhouse.io/ogilvyhealthcanada) | Greenhouse | Toronto/GTA | Greenhouse: no account needed; you apply to each posting with a form. |
| [Omnicom Health](https://www.omc.com/capabilities/capability-health/) | [Careers](https://job-boards.greenhouse.io/omnicomhealth) | Greenhouse | Toronto/GTA | Greenhouse: no account needed; you apply to each posting with a form. |
| [OPEN Health](https://www.openhealthgroup.com/) | [Careers](https://www.openhealthgroup.com/careers/) | Company site | Check each posting for Canadian locations |  |
| [Precision AQ](https://www.precisionaq.com/) | [Careers](https://job-boards.greenhouse.io/precisionaq) | Greenhouse | Canada-eligible remote | Greenhouse: no account needed; you apply to each posting with a form. |
| [Prime Global](https://primeglobalpeople.com/) | [Careers](https://apply.workable.com/primeglobalpeople-join-us/) | Workable | Canada-eligible remote | Workable: no account needed; you apply to each posting with a form. |
| [Publicis Health Canada](https://www.publicishealth.com/) | [Careers](https://careers.publicisgroupe.com/publicishealth/jobs) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Reverba Global](https://reverba.com/) | [Careers](https://reverba.com/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [TANK Worldwide](https://tankww.com/en/) | [Careers](https://job-boards.greenhouse.io/tankww) | Greenhouse | Toronto/GTA | Greenhouse: no account needed; you apply to each posting with a form. |
| [ZS](https://www.zs.com/) | [Careers](https://jobs.zs.com/jobs?country=Canada&page=1) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |

## Consulting & market research

Management consulting firms and market, opinion and analytics research firms.

Typical roles: Analyst / associate consultant, Research analyst, Project director, Data analyst, Strategy & operations associate.

Import id: `consulting-research`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Accenture](https://www.accenture.com/) | [Careers](https://www.accenture.com/ca-en/careers/jobsearch) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [BrandSpark International](https://brandspark.com/) | [Homepage](https://brandspark.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Deloitte](https://www.deloitte.com/) | [Careers](https://careers.deloitte.ca/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Environics Analytics](https://environicsanalytics.com/) | [Careers](https://environicsanalytics.com/about/careers) | Company site | Toronto/GTA |  |
| [Environics Research](https://environics.ca/) | [Careers](https://environics.ca/about/careers/) | Company site | Toronto/GTA |  |
| [Escalent](https://escalent.co/) | [Careers](https://escalent.co/careers-and-culture/) | Company site | Canada |  |
| [EY](https://www.ey.com/en_ca) | [Careers](https://careers.ey.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Hotspex](https://www.hotspex.com/) | [Homepage](https://www.hotspex.com/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Innovative Research Group](https://innovativeresearch.ca/) | [Homepage](https://innovativeresearch.ca/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Ipsos Canada](https://www.ipsos.com/en-ca) | [Careers](https://www.ipsos.com/en-ca/careers) | Company site | Canada |  |
| [KPMG](https://kpmg.com/ca/en.html) | [Careers](https://careers.kpmg.ca/professionals) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Leger](https://leger360.com/) | [Careers](https://leger360.com/careers/) | SmartRecruiters | Toronto/GTA | This careers page hands you off to the employer's SmartRecruiters job site. SmartRecruiters: you can apply as a guest; an account lets you reuse your profile. |
| [Nanos Research](https://nanos.co/) | [Homepage](https://nanos.co/) | Company site | Canada | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Pollara Strategic Insights](https://www.pollara.com/) | [Careers](https://www.pollara.com/careers/) | Company site | Toronto/GTA |  |
| [PwC](https://www.pwc.com/ca) | [Careers](https://jobs-ca.pwc.com/ca/en/search-results) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |

## AI & large technology companies

AI labs, cloud, data platforms and large enterprise technology companies.

Typical roles: Solutions engineer, Customer success manager, Technical account manager, Sales development representative, Product manager, Data analyst.

Import id: `ai-tech`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Adobe](https://www.adobe.com/) | [Careers](https://careers.adobe.com/) | Company site | Toronto/GTA |  |
| [Amazon and AWS](https://www.amazon.com/) | [Careers](https://www.amazon.jobs/) | Company site | Toronto/GTA |  |
| [Anthropic](https://www.anthropic.com/) | [Careers](https://www.anthropic.com/careers) | Company site | Canada-eligible remote |  |
| [Cisco](https://www.cisco.com/) | [Careers](https://careers.cisco.com/) | Company site | Toronto/GTA |  |
| [Cloudflare](https://www.cloudflare.com/) | [Careers](https://www.cloudflare.com/careers/jobs/) | Company site | Toronto/GTA |  |
| [Cohere](https://cohere.com/) | [Careers](https://cohere.com/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Databricks](https://www.databricks.com/) | [Careers](https://www.databricks.com/company/careers/open-positions) | Company site | Toronto/GTA |  |
| [Datadog](https://www.datadoghq.com/) | [Careers](https://careers.datadoghq.com/) | Company site | Canada-eligible remote |  |
| [Dell Technologies](https://www.dell.com/) | [Careers](https://jobs.dell.com/) | Oracle Recruiting | Canada | This careers page hands you off to the employer's Oracle Recruiting job site. Oracle Recruiting: you usually sign in for each employer with your email and a one-time code. |
| [Elastic](https://www.elastic.co/) | [Careers](https://jobs.elastic.co/jobs/country/canada) | Company site | Canada |  |
| [Google](https://about.google/) | [Careers](https://www.google.com/about/careers/applications/) | Company site | Toronto/GTA |  |
| [HP](https://www.hp.com/) | [Careers](https://jobs.hp.com/) | Company site | Toronto/GTA |  |
| [IBM](https://www.ibm.com/) | [Careers](https://www.ibm.com/careers/) | Company site | Canada |  |
| [Intel](https://www.intel.com/) | [Careers](https://intel.wd1.myworkdayjobs.com/en-US/External) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Microsoft](https://www.microsoft.com/) | [Careers](https://careers.microsoft.com/) | Company site | Toronto/GTA |  |
| [MongoDB](https://www.mongodb.com/) | [Careers](https://www.mongodb.com/company/careers) | Company site | Toronto/GTA |  |
| [NVIDIA](https://www.nvidia.com/) | [Careers](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [OpenAI](https://openai.com/) | [Careers](https://openai.com/careers/) | Company site | Toronto/GTA |  |
| [OpenText](https://www.opentext.com/) | [Careers](https://careers.opentext.com/) | Company site | Toronto/GTA |  |
| [Oracle](https://www.oracle.com/) | [Careers](https://careers.oracle.com/) | Company site | Canada |  |
| [Salesforce](https://www.salesforce.com/) | [Careers](https://careers.salesforce.com/) | Company site | Toronto/GTA |  |
| [ServiceNow](https://www.servicenow.com/) | [Careers](https://careers.servicenow.com/) | Company site | Toronto/GTA |  |
| [Snowflake](https://www.snowflake.com/) | [Careers](https://careers.snowflake.com/) | Company site | Toronto/GTA |  |
| [Softchoice](https://www.softchoice.com/) | [Careers](https://careers.softchoice.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Thomson Reuters](https://www.thomsonreuters.com/) | [Careers](https://thomsonreuters.wd5.myworkdayjobs.com/External_Career_Site) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Workday](https://www.workday.com/) | [Careers](https://www.workday.com/en-ca/company/careers/overview.html) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |

## Software & SaaS companies

Business software companies with Canadian offices or Canada-eligible remote roles.

Typical roles: Sales development / business development representative, Account executive, Customer success manager, Solutions consultant, Product manager, Operations analyst.

Import id: `software-saas`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [1Password](https://1password.com/) | [Careers](https://1password.com/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Achievers](https://www.achievers.com/) | [Careers](https://www.achievers.com/company/careers/) | Lever | Toronto/GTA | This careers page hands you off to the employer's Lever job site. Lever: no account needed; you apply to each posting with a form. |
| [Ada](https://www.ada.cx/) | [Careers](https://www.ada.cx/careers/) | Company site | Toronto/GTA |  |
| [ADP](https://www.adp.ca/) | [Careers](https://jobs.adp.com/locations/canada/) | Company site | Toronto/GTA |  |
| [Airtable](https://www.airtable.com/) | [Careers](https://www.airtable.com/careers) | Company site | Check each posting for Canadian locations |  |
| [Amplitude](https://amplitude.com/) | [Careers](https://amplitude.com/careers) | Ashby | Canada | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [ApplyBoard](https://www.applyboard.com/) | [Careers](https://www.applyboard.com/careers/) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Ashby](https://www.ashbyhq.com/) | [Careers](https://www.ashbyhq.com/careers) | Company site | Canada-eligible remote |  |
| [Clio](https://www.clio.com/) | [Careers](https://www.clio.com/ca/about/careers/toronto/) | Company site | Toronto/GTA |  |
| [Coveo](https://www.coveo.com/) | [Careers](https://www.coveo.com/en/company/careers) | Company site | Canada |  |
| [D2L](https://www.d2l.com/) | [Careers](https://www.d2l.com/careers/jobs/) | Company site | Toronto/GTA |  |
| [Deel](https://www.deel.com/) | [Careers](https://jobs.deel.com/) | Company site | Canada-eligible remote |  |
| [Docebo](https://www.docebo.com/) | [Careers](https://www.docebo.com/careers/) | Company site | Toronto/GTA |  |
| [Docusign](https://www.docusign.com/) | [Careers](https://careers.docusign.com/careers-home) | iCIMS | Toronto/GTA | This careers page hands you off to the employer's iCIMS job site. iCIMS: usually asks you to create an account for this employer; save the login. |
| [Drata](https://drata.com/) | [Careers](https://drata.com/about/careers) | Company site | Check each posting for Canadian locations |  |
| [Employment Hero (Humi)](https://employmenthero.com/en-ca/) | [Careers](https://employmenthero.com/careers/) | Company site | Toronto/GTA |  |
| [Figma](https://www.figma.com/) | [Careers](https://www.figma.com/careers/) | Greenhouse | Canada-eligible remote | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Geotab](https://www.geotab.com/) | [Careers](https://careers.geotab.com/jobs?department=All&location=CA&page=1&role=All) | Greenhouse | Toronto/GTA | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [GitLab](https://about.gitlab.com/) | [Careers](https://job-boards.greenhouse.io/gitlab) | Greenhouse | Canada-eligible remote | Greenhouse: no account needed; you apply to each posting with a form. |
| [Gorgias](https://www.gorgias.com/) | [Careers](https://www.gorgias.com/careers) | Company site | Toronto/GTA |  |
| [Harvey](https://www.harvey.ai/) | [Careers](https://www.harvey.ai/careers) | Company site | Toronto/GTA |  |
| [Hiya](https://www.hiya.com/) | [Careers](https://jobs.ashbyhq.com/hiya) | Ashby | Canada-eligible remote | Ashby: no account needed; you apply to each posting with a form. |
| [Hootsuite](https://www.hootsuite.com/) | [Careers](https://careers.hootsuite.com/) | Company site | Toronto/GTA |  |
| [HubSpot](https://www.hubspot.com/) | [Careers](https://www.hubspot.com/careers) | Company site | Toronto/GTA |  |
| [Intelex](https://www.intelex.com/) | [Careers](https://www.intelex.com/careers) | Company site | Toronto/GTA |  |
| [Jobber](https://www.getjobber.com/) | [Careers](https://www.getjobber.com/about/careers/) | Company site | Toronto/GTA |  |
| [Knak](https://knak.com/) | [Careers](https://knak.com/careers/) | Greenhouse | Canada-eligible remote | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [LaunchDarkly](https://launchdarkly.com/) | [Careers](https://launchdarkly.com/careers/) | Greenhouse | Check each posting for Canadian locations | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [MaintainX](https://www.getmaintainx.com/) | [Careers](https://webflow.getmaintainx.com/jobs) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Motive](https://gomotive.com/) | [Careers](https://gomotive.com/company/careers/) | Greenhouse | Toronto/GTA | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Notion](https://www.notion.com/) | [Careers](https://www.notion.com/careers) | Ashby | Check each posting for Canadian locations | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Okta](https://www.okta.com/) | [Careers](https://www.okta.com/company/careers/) | Company site | Toronto/GTA |  |
| [Owner.com](https://www.owner.com/) | [Careers](https://www.owner.com/careers) | Company site | Toronto/GTA |  |
| [PagerDuty](https://www.pagerduty.com/) | [Careers](https://careers.pagerduty.com/jobs/search) | Company site | Toronto/GTA |  |
| [Remote](https://remote.com/) | [Careers](https://remote.com/openings) | Company site | Check each posting for Canadian locations |  |
| [Resolver](https://www.resolver.com/) | [Careers](https://www.resolver.com/careers/) | Company site | Toronto/GTA |  |
| [Retool](https://retool.com/) | [Careers](https://retool.com/careers) | Company site | Check each posting for Canadian locations |  |
| [Rippling](https://www.rippling.com/) | [Careers](https://www.rippling.com/en-CA/careers) | Company site | Check each posting for Canadian locations |  |
| [Samsara](https://www.samsara.com/) | [Careers](https://www.samsara.com/company/careers) | Company site | Canada-eligible remote |  |
| [Sentry](https://sentry.io/) | [Careers](https://sentry.io/careers/) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [ServiceTitan](https://www.servicetitan.com/) | [Careers](https://servicetitan.wd1.myworkdayjobs.com/ServiceTitan) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [SOCi](https://www.soci.ai/) | [Careers](https://job-boards.greenhouse.io/soci) | Greenhouse | Canada | Greenhouse: no account needed; you apply to each posting with a form. |
| [StackAdapt](https://www.stackadapt.com/) | [Careers](https://www.stackadapt.com/careers) | Greenhouse | Toronto/GTA | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Thinkific](https://www.thinkific.com/) | [Careers](https://www.thinkific.com/careers/) | Company site | Canada |  |
| [Top Hat](https://tophat.com/) | [Careers](https://tophat.com/company/work-with-us/) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Twilio](https://www.twilio.com/) | [Careers](https://www.twilio.com/en-us/careers) | Company site | Check each posting for Canadian locations |  |
| [Unbounce](https://unbounce.com/) | [Careers](https://unbounce.com/careers/) | Company site | Canada-eligible remote |  |
| [Vanta](https://www.vanta.com/) | [Careers](https://www.vanta.com/company/careers) | Company site | Canada-eligible remote |  |
| [Vidyard](https://www.vidyard.com/) | [Careers](https://www.vidyard.com/careers/) | Company site | Canada |  |
| [Zapier](https://zapier.com/) | [Careers](https://zapier.com/jobs) | Ashby | Canada-eligible remote | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |

## Banks, fintech & commerce

Banks, insurers, payments and fintech companies, plus commerce and retail technology.

Typical roles: Data / business analyst, Product manager, Strategy & operations associate, Customer success manager, Sales development representative.

Import id: `finance`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Airwallex](https://www.airwallex.com/) | [Careers](https://careers.airwallex.com/) | Company site | Toronto/GTA |  |
| [American Express](https://www.americanexpress.com/) | [Careers](https://careers.americanexpress.com/en/sites/CX_1/jobs) | Oracle Recruiting | Toronto/GTA | This careers page hands you off to the employer's Oracle Recruiting job site. Oracle Recruiting: you usually sign in for each employer with your email and a one-time code. |
| [Bank of America](https://www.bankofamerica.com/) | [Careers](https://careers.bankofamerica.com/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Block](https://block.xyz/) | [Careers](https://block.xyz/careers) | Company site | Toronto/GTA |  |
| [BMO](https://www.bmo.com/) | [Careers](https://jobs.bmo.com/global/en/search-results) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Borrowell](https://borrowell.com/) | [Careers](https://borrowell.com/careers) | Workable | Toronto/GTA | This careers page hands you off to the employer's Workable job site. Workable: no account needed; you apply to each posting with a form. |
| [Brex](https://www.brex.com/) | [Careers](https://www.brex.com/careers) | Company site | Canada-eligible remote |  |
| [CapIntel](https://capintel.com/) | [Careers](https://capintel.com/careers) | Greenhouse | Toronto/GTA | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Capital One](https://www.capitalone.ca/) | [Careers](https://www.capitalonecareers.ca/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [CIBC](https://www.cibc.com/) | [Careers](https://cibc.wd3.myworkdayjobs.com/search) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Citi](https://www.citigroup.com/) | [Careers](https://jobs.citi.com/location/toronto-jobs/7867/6251999-6093943-6167865/4) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Clearco](https://www.clear.co/) | [Careers](https://www.clear.co/careers) | Company site | Toronto/GTA |  |
| [Clutch](https://www.clutch.ca/) | [Careers](https://www.clutch.ca/careers) | Company site | Toronto/GTA |  |
| [Fiserv](https://www.fiserv.com/) | [Careers](https://careers.fiserv.com/) | Company site | Toronto/GTA |  |
| [Float Financial](https://floatfinancial.com/) | [Careers](https://floatfinancial.com/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [FreshBooks](https://www.freshbooks.com/) | [Careers](https://www.freshbooks.com/careers) | Company site | Toronto/GTA |  |
| [Intuit](https://www.intuit.com/) | [Careers](https://jobs.intuit.com/location/toronto-jobs/27595/6251999-6093943-6167865/4) | Company site | Toronto/GTA |  |
| [JPMorgan Chase](https://www.jpmorganchase.com/) | [Careers](https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs) | Oracle Recruiting | Toronto/GTA | Oracle Recruiting: you usually sign in for each employer with your email and a one-time code. |
| [KOHO](https://www.koho.ca/) | [Careers](https://www.koho.ca/careers/) | Ashby | Canada | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Lightspeed Commerce](https://www.lightspeedhq.com/) | [Careers](https://www.lightspeedhq.com/careers/openings/) | Company site | Toronto/GTA |  |
| [Loop Financial](https://bankonloop.com/) | [Careers](https://ats.rippling.com/en-CA/loop-careers/jobs) | Rippling | Toronto/GTA | Rippling: no account needed; you apply to each posting with a form. |
| [Manulife](https://www.manulife.com/) | [Careers](https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Mastercard](https://www.mastercard.com/) | [Careers](https://careers.mastercard.com/us/en/toronto-canada/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Mercury](https://mercury.com/) | [Careers](https://mercury.com/jobs) | Greenhouse | Check each posting for Canadian locations | This careers page hands you off to the employer's Greenhouse job site. Greenhouse: no account needed; you apply to each posting with a form. |
| [Morgan Stanley](https://www.morganstanley.com/) | [Careers](https://ms.wd5.myworkdayjobs.com/External) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Neo Financial](https://www.neofinancial.com/) | [Careers](https://www.neofinancial.com/company/careers) | Company site | Toronto/GTA |  |
| [PayPal](https://www.paypal.com/) | [Careers](https://paypal.wd1.myworkdayjobs.com/jobs) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Prophix](https://www.prophix.com/) | [Careers](https://www.prophix.com/careers/) | Workable | Toronto/GTA | This careers page hands you off to the employer's Workable job site. Workable: no account needed; you apply to each posting with a form. |
| [Ramp](https://ramp.com/) | [Careers](https://ramp.com/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [RBC](https://www.rbc.com/) | [Careers](https://jobs.rbc.com/ca/en/search-results) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Scotiabank](https://www.scotiabank.com/) | [Careers](https://jobs.scotiabank.com/) | SuccessFactors | Toronto/GTA | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Shopify](https://www.shopify.com/) | [Careers](https://www.shopify.com/careers) | Company site | Canada |  |
| [Stripe](https://stripe.com/) | [Careers](https://stripe.com/careers/search) | Company site | Toronto/GTA |  |
| [Sun Life](https://www.sunlife.com/) | [Careers](https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [TD](https://www.td.com/) | [Careers](https://td.wd3.myworkdayjobs.com/TD_Bank_Careers) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [TouchBistro](https://www.touchbistro.com/) | [Careers](https://www.touchbistro.com/careers/) | Company site | Toronto/GTA |  |
| [Vena](https://www.venasolutions.com/) | [Careers](https://careers.venasolutions.com/) | Pinpoint | Toronto/GTA | This careers page hands you off to the employer's Pinpoint job site. |
| [Versapay](https://www.versapay.com/) | [Careers](https://www.versapay.com/careers) | Lever | Canada-eligible remote | This careers page hands you off to the employer's Lever job site. Lever: no account needed; you apply to each posting with a form. |
| [Visa](https://www.visa.com/) | [Careers](https://visa.wd5.myworkdayjobs.com/Visa) | Workday | Toronto/GTA | Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Walmart Canada](https://www.walmartcanada.ca/) | [Careers](https://careers.walmart.ca/) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Wave](https://www.waveapps.com/) | [Careers](https://www.waveapps.com/careers) | Company site | Check each posting for Canadian locations |  |
| [Wealthsimple](https://www.wealthsimple.com/) | [Careers](https://www.wealthsimple.com/en-ca/careers) | Ashby | Toronto/GTA | This careers page hands you off to the employer's Ashby job site. Ashby: no account needed; you apply to each posting with a form. |
| [Xe](https://www.xe.com/) | [Careers](https://careers.xe.com/) | Company site | Toronto/GTA |  |

## Government & public agencies

Federal and provincial agencies and public health organizations.

Typical roles: Research officer, Policy analyst, Epidemiologist / data analyst, Program coordinator, Scientific evaluator.

Import id: `public-sector`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [National Research Council Canada](https://nrc.canada.ca/) | [Careers](https://nrc.canada.ca/en/corporate/careers) | Company site | Toronto/GTA |  |
| [Ontario Health](https://www.ontariohealth.ca/) | [Careers](https://www.ontariohealth.ca/about/work/careers) | Workday | Toronto/GTA | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |
| [Public Health Ontario](https://www.publichealthontario.ca/) | [Careers](https://www.publichealthontario.ca/en/About/Careers/Current%20Job%20Opportunities) | Workday | Canada | This careers page hands you off to the employer's Workday job site. Workday: usually asks you to create a candidate account for this employer (separate from other employers); save the login. |

## Non-profits, charities & research funders

Health charities, research funders, innovation hubs and professional associations.

Typical roles: Research grants / programs officer, Research development officer, Knowledge mobilization specialist, Program manager, Policy analyst.

Import id: `nonprofits-funders`

| Employer | Careers page | Platform | Where | Notes |
| --- | --- | --- | --- | --- |
| [Arthritis Society Canada](https://arthritis.ca/) | [Careers](https://arthritis.ca/about-us/careers/) | Company site | Toronto/GTA |  |
| [Brain Canada Foundation](https://braincanada.ca/) | [Careers](https://braincanada.ca/about/careers) | Company site | Canada |  |
| [Canadian Blood Services](https://www.blood.ca/) | [Careers](https://careers.blood.ca/) | SuccessFactors | Canada | This careers page hands you off to the employer's SuccessFactors job site. SuccessFactors: usually asks you to create a candidate account for this employer; save the login. |
| [Canadian Cancer Society](https://cancer.ca/) | [Careers](https://cancer.ca/en/careers) | Company site | Toronto/GTA |  |
| [CCRM](https://www.ccrm.ca/) | [Careers](https://www.ccrm.ca/ccrm-careers-jobvite/) | Jobvite | Toronto/GTA | This careers page hands you off to the employer's Jobvite job site. Jobvite: usually no account needed; you apply to each posting with a form. |
| [CIFAR](https://cifar.ca/) | [Careers](https://cifar.ca/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Daily Bread Food Bank](https://www.dailybread.ca/) | [Careers](https://dailybreadfoodbank.applytojob.com/) | JazzHR | Toronto/GTA | JazzHR: no account needed; you apply to each posting with a form. |
| [Diabetes Canada](https://www.diabetes.ca/) | [Careers](https://www.diabetes.ca/support-us/volunteer-careers/careers) | Company site | Toronto/GTA |  |
| [Genome Canada](https://genomecanada.ca/) | [Careers](https://genomecanada.ca/about/work-with-us/) | BambooHR | Canada | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Heart & Stroke](https://www.heartandstroke.ca/) | [Careers](https://www.heartandstroke.ca/what-we-do/careers) | Company site | Toronto/GTA |  |
| [MaRS Discovery District](https://www.marsdd.com/) | [Careers](https://www.marsdd.com/careers/) | Company site | Toronto/GTA |  |
| [Mitacs](https://www.mitacs.ca/) | [Careers](https://www.mitacs.ca/careers/) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [MS Canada](https://mscanada.ca/) | [Careers](https://mscanada.ca/careers) | Company site | Toronto/GTA |  |
| [OBIO](https://www.obio.ca/) | [Homepage](https://www.obio.ca/) | Company site | Toronto/GTA | No separate careers page found; check the website and the company's LinkedIn page for openings. |
| [Ontario Brain Institute](https://braininstitute.ca/) | [Careers](https://braininstitute.ca/about-obi/careers) | BambooHR | Toronto/GTA | This careers page hands you off to the employer's BambooHR job site. BambooHR: no account needed; you apply to each posting with a form. |
| [Ontario Genomics](https://www.ontariogenomics.ca/) | [Careers](https://www.ontariogenomics.ca/about-us/careers/) | Company site | Toronto/GTA |  |
| [Ontario Hospital Association](https://www.oha.com/) | [Careers](https://www.oha.com/careers) | Company site | Toronto/GTA |  |
| [Ontario Medical Association](https://www.oma.org/) | [Careers](https://www.oma.org/about-the-oma/careers/job-postings/) | Company site | Toronto/GTA |  |
| [OpenAlex](https://openalex.org/) | [Careers](https://openalex.org/jobs) | Company site | Canada-eligible remote |  |
