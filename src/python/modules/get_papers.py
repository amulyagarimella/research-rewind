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
    dates_back = {n: (today - relativedelta(years=n)).strftime("%Y-%m-%d") for n in yeardeltas}
    for yd, date in dates_back.items():
        # get papers
        # Just querying nature for now, and just getting the top most cited paper
        org_id = "https://openalex.org/P4310319908"
        url = f"https://api.openalex.org/works?mailto={os.environ.get("EMAIL_ADDRESS")}?filter=publication_date:{date},topics.field.id:{"|".join(fields)},locations.source.host_organization:{org_id}?sort=cited_by_count?page=1&per-page=1"
        response = requests.get(url)
        if response.ok:
            data = response.json()
            title = data["results"][0]["title"]
            doi = data["results"][0]["ids"]["doi"]
            subfield = data["results"][0]["topics"][0]["subfield"]["display_name"]
            print(doi, title)
            results[yd] = {"title": title, "doi": doi, "subfield": subfield}
    return today, results

def format_subj_and_body (data):
    yeardeltas = data["yeardeltas"]
    fields = data["fields"]
    print("DEBUG", yeardeltas, fields)
    fields_int = [int(re.search(r'\d+', f).group()) for f in fields]
    today, results = get_papers(yeardeltas, fields_int)
    subj = f"Research rewind {today.strftime('%Y-%m-%d')}"
    for yd, result in results.items():
        body += f"{yd} years ago: Title: {result['title']}, DOI: {result['doi']} (Topic: {result['subfield']})\n"
    return {
        "subject": subj,
        "body": body
    }

if __name__ == "__main__":
    result = format_subj_and_body(sys.argv[1])
    print(json.dumps(result))
 