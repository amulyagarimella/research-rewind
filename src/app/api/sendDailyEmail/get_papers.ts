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

interface RequestCache {
    [key: string]: Paper | null; // null means "no paper found"
}

// Global cache for this execution
const requestCache: RequestCache = {};

// Add delay between requests to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function generateCacheKey(yearDelta: number, fields: string[]): string {
    const today = DateTime.now().setZone('America/New_York');
    const prev_date_str = today.minus({ years: yearDelta }).toISODate();
    return `${prev_date_str}-${fields.sort().join('|')}`;
}

async function fetchPaperForDate(yearDelta: number, fields: string[]): Promise<Paper | null> {
    const today = DateTime.now().setZone('America/New_York');
    const prev_date = today.minus({ years: yearDelta });
    const prev_date_str = prev_date.toISODate();

    const filters = new Map<string, string>([
        ["publication_date", prev_date_str || ""],
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

    console.log(`Making API request for year delta: ${yearDelta}, fields: ${fields.join(',')}`);

    try {
        const response = await fetch(url);
        
        if (response.ok) {
            const data = await response.json();
            const openalex_result = data.results;
            
            if (openalex_result.length > 0) {
                const res = openalex_result[0];
                const paper: Paper = {
                    year_delta: yearDelta,
                    title: res.title,
                    publication_date: res.publication_date,
                    main_field: res.topics?.[0]?.subfield?.display_name || 'Unknown',
                    authors: res.authorships?.map((author: any) => author.author.display_name) || [],
                    doi: res.doi,
                    url: res.primary_location?.landing_page_url || res.doi,
                };
                console.log(`Found paper: ${paper.title}`);
                return paper;
            } else {
                console.log(`No papers found for year delta ${yearDelta}`);
                return null;
            }
        } else {
            console.error(`OpenAlex API failed: ${response.status} ${response.statusText}`);
            if (response.status === 429) {
                console.error('Rate limited - waiting longer...');
                await delay(2000); // Wait 2 seconds on rate limit
            } else if (response.status >= 500) {
                console.error('Server error - continuing');
            }
            return null;
        }
    } catch (error) {
        console.error(`Request failed for year delta ${yearDelta}:`, error);
        return null;
    }
}

export async function get_papers(yeardeltas: number[], fields: string[]): Promise<Paper[]> {
    const papers: Paper[] = [];
    const uniqueRequests = new Map<string, number>();
    
    console.log(`Processing ${yeardeltas.length} year deltas for fields: ${fields.join(',')}`);
    
    // Identify unique requests needed
    for (const yearDelta of yeardeltas) {
        const cacheKey = generateCacheKey(yearDelta, fields);
        if (!uniqueRequests.has(cacheKey)) {
            uniqueRequests.set(cacheKey, yearDelta);
        }
    }
    
    console.log(`Deduplication: ${yeardeltas.length} requests → ${uniqueRequests.size} unique API calls`);
    
    // Make API calls for cache misses
    let apiCallCount = 0;
    for (const [cacheKey, yearDelta] of uniqueRequests) {
        if (!(cacheKey in requestCache)) {
            // Rate limiting: 100ms delay between requests
            if (apiCallCount > 0) {
                await delay(100);
            }
            
            const paper = await fetchPaperForDate(yearDelta, fields);
            requestCache[cacheKey] = paper;
            apiCallCount++;
        } else {
            console.log(`Cache hit for year delta ${yearDelta}`);
        }
    }
    
    // Build results from cache
    for (const yearDelta of yeardeltas) {
        const cacheKey = generateCacheKey(yearDelta, fields);
        const cachedPaper = requestCache[cacheKey];
        
        if (cachedPaper) {
            // Create a copy with the correct year_delta for this request
            papers.push({
                ...cachedPaper,
                year_delta: yearDelta
            });
        }
    }
    
    console.log(`Returning ${papers.length} papers (made ${apiCallCount} API calls)`);
    return papers;
}

// Batch processing for multiple users
export interface UserRequest {
    userId: string;
    intervals: number[];
    subjects: string[];
}

export interface BatchResult {
    userId: string;
    papers: Paper[];
    apiCallsUsed: number;
}

export async function get_papers_batch(userRequests: UserRequest[]): Promise<BatchResult[]> {
    console.log(`Starting batch processing for ${userRequests.length} users`);
    
    // Clear cache for this batch
    Object.keys(requestCache).forEach(key => delete requestCache[key]);
    
    const results: BatchResult[] = [];
    let totalApiCalls = 0;
    
    for (let i = 0; i < userRequests.length; i++) {
        const user = userRequests[i];
        const startApiCalls = Object.keys(requestCache).length;
        
        console.log(`Processing user ${i + 1}/${userRequests.length}: ${user.userId}`);
        
        const papers = await get_papers(user.intervals, user.subjects);
        
        const endApiCalls = Object.keys(requestCache).length;
        const apiCallsForThisUser = endApiCalls - startApiCalls;
        totalApiCalls += apiCallsForThisUser;
        
        results.push({
            userId: user.userId,
            papers: papers,
            apiCallsUsed: apiCallsForThisUser
        });
        
        // Small delay between users
        if (i < userRequests.length - 1) {
            await delay(50);
        }
    }
    
    return results;
}

// Export the original function as well for backward compatibility
export async function get_papers_original(yeardeltas: number[], fields: string[]): Promise<Paper[]> {
    const today = DateTime.now().setZone('America/New_York');
    const papers: Paper[] = [];
    
    console.log(`Fetching papers (original method) for ${yeardeltas.length} year deltas and ${fields.length} fields`);
    
    for (let i = 0; i < yeardeltas.length; i++) {
        // Rate limiting: 100ms delay between requests
        if (i > 0) {
            await delay(100);
        }
        
        const prev_date = today.minus({ years: yeardeltas[i] });
        const prev_date_str = prev_date.toISODate();

        const filters = new Map<string, string>([
            ["publication_date", prev_date_str || ""],
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

        try {
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                const openalex_result = data.results;
                
                if (openalex_result.length > 0) {
                    const res = openalex_result[0];
                    const paper: Paper = {
                        year_delta: yeardeltas[i],
                        title: res.title,
                        publication_date: res.publication_date,
                        main_field: res.topics?.[0]?.subfield?.display_name || 'Unknown',
                        authors: res.authorships?.map((author: any) => author.author.display_name) || [],
                        doi: res.doi,
                        url: res.primary_location?.landing_page_url || res.doi,
                    };
                    papers.push(paper);
                }
            } else if (response.status === 429) {
                await delay(1000);
            }
        } catch (error) {
            console.error(`Request failed for year delta ${yeardeltas[i]}:`, error);
        }
    }
    
    return papers;
}   