from flask import Flask, jsonify
from elegantrl.run import Arguments, train_and_evaluate
from elegantrl.agent import AgentPPO
from env import CodeReviewEnv
import multiprocessing

app = Flask(__name__)

# A simple way to keep track of the training process
training_process = None

def run_training():
    args = Arguments(agent=AgentPPO(), env=CodeReviewEnv())
    args.gamma = 0.99
    args.break_step = 1e6
    args.net_dim = 2**8
    args.max_step = args.net_dim * 4
    args.batch_size = args.net_dim
    args.repeat_times = 2**3
    args.eval_gap = 30
    args.eval_times1 = 2
    args.eval_times2 = 4

    train_and_evaluate(args)

@app.route('/train', methods=['POST'])
def start_training():
    global training_process
    if training_process and training_process.is_alive():
        return jsonify({'message': 'Training is already in progress.'}), 400

    training_process = multiprocessing.Process(target=run_training)
    training_process.start()

    return jsonify({'message': 'Training started.'})

@app.route('/status', methods=['GET'])
def get_status():
    global training_process
    if training_process and training_process.is_alive():
        return jsonify({'status': 'Training in progress.'})
    else:
        return jsonify({'status': 'No active training process.'})

if __name__ == '__main__':
    app.run(debug=True, port=5001)
