import requests
from datetime import datetime
from dateutil.relativedelta import relativedelta
from typing import List
import os
import re
import json
import sys

def get_papers(yeardeltas:List[int], fields:List[int]):
    today = datetime.now()
    results = {}
    # get yd years back
    fields = [str(f) for f in fields]
    dates_back = {yd: (today - relativedelta(years=yd)).strftime("%Y-%m-%d") for yd in yeardeltas}
    # urls = []
    for yd, date in dates_back.items():
        # get papers
        # Just querying nature for now, and just getting the top most cited paper
        org_id = "https://openalex.org/P4310319908"
        url = f"https://api.openalex.org/works?filter=publication_date:{date},topics.field.id:{"|".join(fields)},locations.source.host_organization:{org_id}?sort=cited_by_count?page=1&per-page=1"
        # urls.append(url)
        response = requests.get(url)
        if response.ok:
            data = response.json()
            if len(data["results"]) == 0:
                continue
            title = data["results"][0]["title"]
            doi = data["results"][0]["ids"]["doi"]
            subfield = data["results"][0]["topics"][0]["subfield"]["display_name"]
            pub_date = data["results"][0]["publication_date"]
            authors = data["results"][0]["authorships"]
            results[yd] = {"title": title, "doi": doi, "subfield": subfield, "date": pub_date, "authors": [a["author"]["display_name"] for a in authors]}
    return today, results

def format_subj_and_body (data):
    def format_authors(authors):
        if len(authors) > 3:
            return ", ".join(authors[:3]) + "..." + authors[-1]
        return ", ".join(authors)
    data = json.loads(data)
    yeardeltas = data["yeardeltas"]
    fields = data["fields"]
    fields_int = [int(re.search(r'\d+', f).group()) for f in fields if "field" in f]

    today, results = get_papers(yeardeltas, fields_int)
    subj = f"Research rewind {today.strftime('%Y-%m-%d')} 🔬⏪"
    body = ""
    for yd, res in results.items():
        year_or_years = "year" if yd == 1 else "years"
        body += f"<b>{yd} {year_or_years} ago ({res['date']}):</b> <a href=\"{res['doi']}\" target=\"_blank\" rel=\"noopener noreferrer\">{res['title']}</a> - {format_authors(res['authors'])}<br>(Topic: {res['subfield']})<br><br>"
    return {
        "subject": subj,
        "body": body,
    }

if __name__ == "__main__":
    result = format_subj_and_body(sys.argv[1])
    print(json.dumps(result))
 