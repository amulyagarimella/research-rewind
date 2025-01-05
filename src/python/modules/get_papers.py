import requests
from datetime import datetime
from dateutil.relativedelta import relativedelta
from typing import List
from diophila import OpenAlex

openalex = OpenAlex()


def get_papers(yeardeltas:List[int] = [1,2,3], fields:List[int]=[1,2,3,4]):
    today = datetime.now()

    results = {}
    
    # get yd years back
    dates_back = {n: (today - relativedelta(years=n)).strftime("%Y-%m-%d") for n in yeardeltas}
    for date in dates_back:
        # get papers
        # Just querying nature for now, and just getting the top most cited paper
        org_id = "https://openalex.org/P4310319908"
        url = f"https://api.openalex.org/works?filter=publication_date:{date},topics.field.id:{"|".join(fields)},locations.source.host_organization:{org_id}?sort=cited_by_count?page=1&per-page=1"
        response = requests.get(url)
        if response.ok:
            data = response.json()
            title = data["results"][0]["title"]
            doi = data["results"][0]["ids"]["doi"]
            print(doi, title)
            results[date] = {"title": title, "doi": doi}
    return results

