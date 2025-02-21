
import { DateTime } from "ts-luxon";
// 2025-01-06: Not using the OpenAlex SDK since it still uses the old OpenAlex API - concepts instead of fields/subfields

export interface Paper { 
    year_delta: number,
    title: string,
    publication_date: string,
    main_field: string,
    authors: string[],
    doi: string,
    url: string,
}

export async function get_papers (yeardeltas:number[], fields:string[]) {
    const today = DateTime.now().setZone('America/New_York');
    // const org_id = "https://openalex.org/S137773608";

    const papers: Paper[] = [];
    for (let i = 0; i < yeardeltas.length; i++) {
        const prev_date = today.minus({ years: yeardeltas[i] });
        const prev_date_str = prev_date.toISODate();
        //console.log("DEBUG - prev_date_str: ", prev_date_str);

        const filters = new Map<string,string>([
            ["publication_date", prev_date_str],
            ["topics.field.id", fields.join('|')],
            ["type","article"],
            // ["locations.source.id", org_id],
        ])
        const openalex_filter = [...filters].map(([k, v]) => `${k}:${v}`).join(',');

        console.log("DEBUG - url:", 'https://api.openalex.org/works?' + new URLSearchParams({
            filter: openalex_filter,
            sort: 'cited_by_count:desc',
            page: '1',
            per_page: '1',
        }).toString() + `&mailto=${process.env.EMAIL_ADDRESS}`);

        const response = await fetch('https://api.openalex.org/works?' + new URLSearchParams({
            filter: openalex_filter,
            sort: 'cited_by_count:desc',
            page: '1',
            per_page: '1',
        }).toString() + `&mailto=${process.env.EMAIL_ADDRESS}`);
        
        if (response.ok) {
            const data = await response.json();
            const openalex_result = data.results;
            if (openalex_result.length > 0) {
                const res = openalex_result[0];
                const paper = {
                    year_delta: yeardeltas[i],
                    title: res.title,
                    publication_date: res.publication_date,
                    main_field: res.topics[0].subfield.display_name,
                    authors: res.authorships.map((author: any) => author.author.display_name),
                    doi: res.doi,
                    url: res.primary_location.landing_page_url,
                };
                papers.push(paper);
            }
        } else {
            console.log("DEBUG - response: ", response);
            console.error('OpenAlex API request failed');
        }
    }
    // console.log("DEBUG - papers: ", papers);
    return papers;
}

get_papers([1, 5, 10, 50, 100], ["11", "17", "28", "24", "30", "13"]).then(console.log);