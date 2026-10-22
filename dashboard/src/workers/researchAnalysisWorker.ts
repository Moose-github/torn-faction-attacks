import { loadPyodide, version } from 'pyodide';
import extraction from '../../../research/extraction.py?raw';
import analysis from '../../../research/analysis.py?raw';
import evidence from '../../../research/evidence.py?raw';
import graphs from '../../../research/graphs.py?raw';
import datasetAnalysis from '../../../research/dataset_analysis.py?raw';

let runtime: Awaited<ReturnType<typeof loadPyodide>> | undefined;
self.onmessage = async (event: MessageEvent<{ id: number; action: 'init' | 'page' | 'finish'; json?: string; runtimeBase?: string }>) => {
  const { id, action, json, runtimeBase } = event.data;
  try {
    let result = '';
    if (action === 'init') {
      runtime = await loadPyodide({ indexURL: `${runtimeBase}research-runtime/${version}/` });
      await runtime.loadPackage('numpy');
      for (const [name, source] of Object.entries({ extraction, analysis, evidence, graphs, dataset_analysis: datasetAnalysis })) {
        runtime.FS.writeFile(`/home/pyodide/${name}.py`, source);
      }
      runtime.globals.set('input_json', json!);
      await runtime.runPythonAsync('import json\nfrom dataset_analysis import DatasetAnalysis, compact_analysis\nargs = json.loads(input_json)\njob = DatasetAnalysis(args["meta"], args["prices"])\ndel input_json, args');
    } else {
      if (!runtime) throw new Error('Analysis engine has not started.');
      if (action === 'page') {
        runtime.globals.set('input_json', json!);
        await runtime.runPythonAsync('job.add(json.loads(input_json))\ndel input_json');
      } else {
        result = await runtime.runPythonAsync('json.dumps(compact_analysis(job.finish()), allow_nan=False, separators=(",", ":"))');
      }
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Analysis could not finish.' });
  }
};
