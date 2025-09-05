import { DateTime } from "ts-luxon";

export interface Paper { 
    year_delta: number,
    title: string,
    publication_date: string,
    main_field: string,
    authors: string[],
    doi: string,
    url: string,
}

// Add delay between requests to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function get_papers(yeardeltas: number[], fields: string[]) {
    const today = DateTime.now().setZone('America/New_York');
    const papers: Paper[] = [];
    
    console.log(`Fetching papers for ${yeardeltas.length} year deltas and ${fields.length} fields`);
    
    for (let i = 0; i < yeardeltas.length; i++) {
        // Rate limiting: 100ms delay between requests (10 req/sec max)
        if (i > 0) {
            await delay(100);
        }
        
        const prev_date = today.minus({ years: yeardeltas[i] });
        const prev_date_str = prev_date.toISODate();

        const filters = new Map<string, string>([
            ["publication_date", prev_date_str],
            ["topics.field.id", fields.join('|')],
            ["type", "article"],
        ]);
        
        const openalex_filter = [...filters].map(([k, v]) => `${k}:${v}`).join(',');
        const url = 'https://api.openalex.org/works?' + new URLSearchParams({
            filter: openalex_filter,
            sort: 'cited_by_count:desc',
            page: '1',
            per_page: '1',
        }).toString() + `&mailto=${process.env.EMAIL_ADDRESS}`;

        console.log(`Request ${i + 1}/${yeardeltas.length} - Year delta: ${yeardeltas[i]}`);

        try {
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                const openalex_result = data.results;
                
                if (openalex_result.length > 0) {
                    const res = openalex_result[0];
                    const paper = {
                        year_delta: yeardeltas[i],
                        title: res.title,
                        publication_date: res.publication_date,
                        main_field: res.topics?.[0]?.subfield?.display_name || 'Unknown',
                        authors: res.authorships?.map((author: any) => author.author.display_name) || [],
                        doi: res.doi,
                        url: res.primary_location?.landing_page_url || res.doi,
                    };
                    papers.push(paper);
                    console.log(`Found paper: ${paper.title}`);
                } else {
                    console.log(`No papers found for year delta ${yeardeltas[i]}`);
                }
            } else {
                console.error(`OpenAlex API failed: ${response.status} ${response.statusText}`);
                if (response.status === 429) {
                    console.error('Rate limited - waiting longer...');
                    await delay(1000); // Wait 1 second on rate limit
                } else if (response.status >= 500) {
                    console.error('Server error - continuing with next request');
                }
            }
        } catch (error) {
            console.error(`Request failed for year delta ${yeardeltas[i]}:`, error);
            // Continue with next request
        }
    }
    
    console.log(`Successfully fetched ${papers.length} papers out of ${yeardeltas.length} requests`);
    return papers;
}