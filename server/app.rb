require 'sinatra'
require 'json'

before do
  response.headers['Access-Control-Allow-Origin'] = '*'
  response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  response.headers['Access-Control-Allow-Headers'] = 'Origin, Content-Type, Accept, Authorization'
end

options "*" do
  200
end

set :public_folder, File.dirname(__FILE__) + '/static'

get '/' do
  @message = "Welcome chat server"
  erb :index
end

get '/api/api_origins' do
  content_type :json
  {
    "data" => {
      "api_origins" => ["#{request.scheme}://#{request.host}:#{request.port}"]
    }
  }.to_json
end

post '/api/dialog_config' do
  content_type :json
  {data:nil}.to_json
end

# post '/api/model_configs' do
#   content_type :json
#   {data:{option_groups:[]}}.to_json
# end

get '/api/remote_config/setting_chatboxai_first' do
  content_type :json
  {data:{setting_chatboxai_first:true}}.to_json
end

get '/api/copilots/list' do
  content_type :json
  json_path = File.expand_path('data/copilots_list.json', __dir__)
  list = JSON.parse(File.read(json_path))
  { data: list }.to_json
end

post '/api/copilots/list' do
  content_type :json
  json_path = File.expand_path('data/copilots_list.json', __dir__)
  list = JSON.parse(File.read(json_path))
  { data: list }.to_json
end

get '/api/copilots/share-record' do
  content_type :json
  {data:nil}.to_json
end

post '/api/copilots/share-record' do
  content_type :json
  {data:nil}.to_json
end

get '/api/remote_config' do
  content_type :json
  {data:{setting_chatboxai_first:true}}.to_json
end

post '/api/model_configs' do
  request.body.rewind
  content_type :json
  conf_data = request.body.read
  puts conf_data
  ret = {
    data: {
      option_groups: []
    }
  }
  begin
    conf = JSON.parse(conf_data)
  rescue StandardError => e
    return ret.to_json
  end
  data = ret[:data]
  case conf['aiProvider']
  # when 'openai'
  when 'claude'
    data[:option_groups] = [
      {
        "options": [
          {
            "label": "claude-3-5-haiku-20241022",
            "value": "claude-3-5-haiku-20241022"
          },
          {
            "label": "claude-3-5-sonnet-latest",
            "value": "claude-3-5-sonnet-latest"
          },
          {
            "label": "claude-3-5-sonnet-20241022",
            "value": "claude-3-5-sonnet-20241022"
          }
        ]
      }
    ]
  when 'gemini'
    data[:option_groups] = [
      {
        "options": [
          {
            "label": "gemini-1.5-pro-exp-0827",
            "value": "gemini-1.5-pro-exp-0827"
          },
          {
            "label": "gemini-1.5-flash-exp-0827",
            "value": "gemini-1.5-flash-exp-0827"
          },
          {
            "label": "gemini-1.5-flash-8b-exp-0924",
            "value": "gemini-1.5-flash-8b-exp-0924"
          }
        ]
      }
    ]
  # when 'deepseek'
  # when 'siliconflow'
  # when 'azure'
  # when 'xAI'
  # when 'perplexity'
  # when 'chatglm-6b'
  when 'groq'
    data[:option_groups] = [
      {
        "options": [
          {
            "label": "llama-3.2-1b-preview",
            "value": "llama-3.2-1b-preview"
          },
          {
            "label": "llama-3.2-3b-preview",
            "value": "llama-3.2-3b-preview"
          },
          {
            "label": "llama-3.2-11b-text-preview",
            "value": "llama-3.2-11b-text-preview"
          },
          {
            "label": "llama-3.2-90b-text-preview",
            "value": "llama-3.2-90b-text-preview"
          }
        ]
      }
    ]
  end
  ret.to_json
end
