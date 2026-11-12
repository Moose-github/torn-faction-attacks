import {describe,it,expect} from 'vitest';
import {filterRecruitmentCandidates} from './recruitmentCandidates';
import type {RecruitmentResults} from '../../../shared/recruitment';

describe('local recruitment filtering',()=>{
  const data:RecruitmentResults={version:1,snapshot:null,snapshot_id:'snapshot',total:121,matched:120,unknown:1,page:0,
    candidates:Array.from({length:121},(_,i)=>({player_id:i+1,username:`Player${i+1}`,city_job:i%2?'Army':null,
      level:10,faction_id:null,total_work_stats:i===120?null:200000-i*100, hof_position:i+1,work_stats_checked_at:1}))};
  const filters={job:'all',coverage:'matched',min:'100000',max:'',q:''};
  it('paginates the same loaded dataset and combines filters',()=>{
    expect(filterRecruitmentCandidates(data,filters,1).candidates[0].player_id).toBe(51);
    expect(filterRecruitmentCandidates(data,filters,2).candidates).toHaveLength(20);
    expect(filterRecruitmentCandidates(data,{...filters,job:'Army',max:'199000'},0).total).toBe(55);
    expect(filterRecruitmentCandidates(data,{...filters,q:'PLAYER11'},0).total).toBe(11);
    expect(filterRecruitmentCandidates(data,{...filters,q:'37'},0).candidates[0].player_id).toBe(37);
  });
  it('keeps unknowns explicit and ignores stat bounds for unknown-only results',()=>{
    expect(filterRecruitmentCandidates(data,{...filters,coverage:'unknown',max:'1'},0).candidates[0].player_id).toBe(121);
    expect(filterRecruitmentCandidates(data,{...filters,coverage:'all'},0).total).toBe(121);
    expect(data.candidates).toHaveLength(121);
  });
});
